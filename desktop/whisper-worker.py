# Cuesta Resident Neural Dictation & Command Worker (faster-whisper)
# High-precision local neural ASR. Completely offline, CPU int8 quantized,
# zero SAPI5 / legacy speech dependencies. If this worker cannot start, the
# Electron host automatically falls back to desktop/speech-worker.ps1.

import sys
import os
import time
import base64
import threading
import queue
import re
import traceback
import numpy as np

# Force UTF-8 I/O where supported (fails harmlessly for non-text pipes)
for stream in (sys.stdin, sys.stdout):
    try:
        stream.reconfigure(encoding="utf-8")
    except Exception:
        pass

MODEL_NAME = os.environ.get("CUESTA_WHISPER_MODEL", "small.en")
LANGUAGE = os.environ.get("CUESTA_WHISPER_LANGUAGE", "en") or None

SAMPLE_RATE = 16000
BLOCK_SIZE = 1600        # 100ms blocks
SILENCE_PAUSE_CHUNKS = 6 # ~600ms of silence ends an utterance
MIN_SPEECH_CHUNKS = 3    # at least 300ms of audio
MAX_PHRASE_CHUNKS = 180  # hard cap ~18s before segmenting

# Baseline energy gates; raised automatically by the measured noise floor.
BASE_RMS_THRESH = 0.004
BASE_PEAK_THRESH = 0.016

# Whisper hallucinations to discard on near-silent utterances
HALLUCINATIONS = {
    "thank you", "thanks for watching", "bye", "you",
    "thank you for watching", "so", "please subscribe", "like and subscribe",
    "thank you very much", "thanks", "okay", "ok", "yeah",
}

NOISE_TAG_PATTERN = re.compile(
    r"[\[(]\s*(music|applause|laughter|silence|inaudible|noise|blank_audio)\s*[\])]",
    re.IGNORECASE,
)
LEADING_FILLER_PATTERN = re.compile(r"^(um+|uh+|erm+|hmm+)[,\s]+", re.IGNORECASE)
REPEATED_WORD_PATTERN = re.compile(r"\b(\w+)(\s+\1\b){2,}", re.IGNORECASE)


def to_b64(text: str) -> str:
    return base64.b64encode((text or "").encode("utf-8")).decode("ascii")


def emit(line: str):
    try:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()
    except Exception:
        pass


def log_err(message: str):
    try:
        sys.stderr.write(message + "\n")
        sys.stderr.flush()
    except Exception:
        pass


def clean_transcript(raw: str) -> str:
    """Remove ASR artifacts without changing the user's words."""
    text = NOISE_TAG_PATTERN.sub(" ", raw or "")
    text = LEADING_FILLER_PATTERN.sub("", text.strip())
    text = REPEATED_WORD_PATTERN.sub(r"\1", text)
    text = re.sub(r"\s+", " ", text).strip()
    # Collapse an utterance the model repeated verbatim ("Good. Good.")
    for _ in range(2):
        words = text.split(" ")
        half = len(words) // 2
        if half >= 2 and words[:half] == words[half : half * 2]:
            text = " ".join(words[:half])
    return text.strip()


def looks_like_hallucination(text: str) -> bool:
    lower = text.lower().strip(" .!?,")
    return (
        not lower
        or lower in HALLUCINATIONS
        or lower.startswith("subtitles by")
        or lower.startswith("subtitle by")
        or lower.startswith("sous-titres")
        or lower.startswith("amara.org")
    )


class WhisperHost:
    def __init__(self):
        self.model = None
        self.current_mode = "dictation"  # "dictation" or "control"
        self.is_listening = False
        self.audio_queue = queue.Queue()
        self.stream = None
        self.sd = None
        self.worker_thread = None
        self.stop_event = threading.Event()
        self.lock = threading.Lock()
        # Adaptive noise floor: the 25th percentile of recent idle blocks.
        self.noise_samples = []
        self.rms_threshold = BASE_RMS_THRESH
        self.peak_threshold = BASE_PEAK_THRESH

    def init_model(self):
        emit("STATUS:loading")
        try:
            from faster_whisper import WhisperModel
            import sounddevice as sd

            self.sd = sd
            cpu_threads = max(2, min(8, (os.cpu_count() or 4) // 2))
            self.model = WhisperModel(
                MODEL_NAME,
                device="cpu",
                compute_type="int8",
                cpu_threads=cpu_threads,
                download_root=os.environ.get("CUESTA_WHISPER_CACHE") or None,
            )
            emit("READY")
            return True
        except ImportError as exc:
            missing = getattr(exc, "name", "") or str(exc)
            emit(
                "ERR_B64:"
                + to_b64(
                    f"Missing Python speech package ({missing}). Run `npm run speech:setup` "
                    "or `pip install faster-whisper sounddevice numpy`."
                )
            )
            return False
        except Exception as exc:
            emit("ERR_B64:" + to_b64(f"Whisper model could not load: {exc}"))
            return False

    def audio_callback(self, indata, frames, time_info, status):
        if not self.is_listening:
            return
        self.audio_queue.put(indata.copy().flatten())

    def start_listening(self):
        with self.lock:
            if self.is_listening:
                emit("STATUS:listening")
                return

            try:
                if self.worker_thread and self.worker_thread.is_alive():
                    self.worker_thread.join(timeout=1.5)
                    self.worker_thread = None

                while not self.audio_queue.empty():
                    try:
                        self.audio_queue.get_nowait()
                    except queue.Empty:
                        break

                self.stop_event.clear()
                self.stream = self.sd.InputStream(
                    samplerate=SAMPLE_RATE,
                    channels=1,
                    dtype="float32",
                    blocksize=BLOCK_SIZE,
                    callback=self.audio_callback,
                )
                self.stream.start()
                self.is_listening = True

                self.worker_thread = threading.Thread(target=self._process_audio_loop, daemon=True)
                self.worker_thread.start()

                emit("STATUS:listening")
            except Exception as exc:
                self.is_listening = False
                emit(
                    "ERR_B64:"
                    + to_b64(
                        "Microphone unavailable. Check the default input device in Windows "
                        f"Sound settings. ({exc})"
                    )
                )

    def stop_listening(self):
        with self.lock:
            if not self.is_listening:
                emit("STATUS:off")
                return

            self.is_listening = False
            self.stop_event.set()

            if self.stream:
                try:
                    self.stream.stop()
                    self.stream.close()
                except Exception:
                    pass
                self.stream = None

            if self.worker_thread and self.worker_thread.is_alive():
                try:
                    self.worker_thread.join(timeout=2.0)
                except Exception:
                    pass
                self.worker_thread = None

            emit("STATUS:off")

    def set_mode(self, mode: str):
        self.current_mode = "control" if mode.lower() == "control" else "dictation"

    def _calibrate_noise(self, chunk: np.ndarray):
        rms = float(np.sqrt(np.mean(chunk ** 2)))
        self.noise_samples.append(rms)
        if len(self.noise_samples) > 80:
            self.noise_samples.pop(0)
        if len(self.noise_samples) < 8:
            return
        ordered = sorted(self.noise_samples)
        floor = ordered[len(ordered) // 4]
        self.rms_threshold = max(BASE_RMS_THRESH, floor * 2.2)
        self.peak_threshold = max(BASE_PEAK_THRESH, floor * 4.0)

    def _is_speech_chunk(self, chunk: np.ndarray) -> bool:
        if len(chunk) == 0:
            return False
        rms = float(np.sqrt(np.mean(chunk ** 2)))
        peak = float(np.max(np.abs(chunk)))
        return rms >= self.rms_threshold or peak >= self.peak_threshold

    def _transcribe_audio(self, audio_data: np.ndarray):
        if len(audio_data) < (SAMPLE_RATE * 0.25):
            return

        peak = float(np.max(np.abs(audio_data)))
        rms = float(np.sqrt(np.mean(audio_data ** 2)))
        if peak < 0.01 and rms < 0.003:
            return  # ambient noise floor

        try:
            segments, _info = self.model.transcribe(
                audio_data,
                language=LANGUAGE,
                beam_size=3,
                best_of=3,
                vad_filter=True,
                vad_parameters=dict(min_silence_duration_ms=250, speech_pad_ms=180),
                condition_on_previous_text=False,
                no_speech_threshold=0.55,
                log_prob_threshold=-1.0,
                without_timings=True,
            )
            raw_text = " ".join(seg.text for seg in segments)
            cleaned = clean_transcript(raw_text)
            if looks_like_hallucination(cleaned):
                return

            lower = cleaned.lower()
            is_control = self.current_mode == "control"
            if is_control:
                emit("CMD_B64:" + to_b64(cleaned))
            else:
                emit("FINAL_B64:" + to_b64(cleaned))
        except Exception as exc:
            log_err(f"transcription failed: {exc}")

    def _process_audio_loop(self):
        state = "IDLE"
        pre_roll = []  # ~200ms of audio before speech onset
        accumulated_chunks = []
        silence_count = 0
        last_level_time = time.time()

        while not self.stop_event.is_set():
            try:
                chunk = self.audio_queue.get(timeout=0.1)
            except queue.Empty:
                continue

            now = time.time()
            if now - last_level_time >= 0.08:
                last_level_time = now
                rms = float(np.sqrt(np.mean(chunk ** 2)))
                level = int(min(100, max(0, rms * 500)))
                emit(f"LEVEL:{level}")

            has_speech = self._is_speech_chunk(chunk)

            if state == "IDLE":
                self._calibrate_noise(chunk)
                if has_speech:
                    state = "SPEAKING"
                    accumulated_chunks = list(pre_roll)
                    accumulated_chunks.append(chunk)
                    silence_count = 0
                else:
                    pre_roll.append(chunk)
                    if len(pre_roll) > 2:
                        pre_roll.pop(0)

            elif state == "SPEAKING":
                accumulated_chunks.append(chunk)
                if has_speech:
                    silence_count = 0
                else:
                    silence_count += 1

                phrase_ready = (
                    silence_count >= SILENCE_PAUSE_CHUNKS
                    and len(accumulated_chunks) >= MIN_SPEECH_CHUNKS
                )
                phrase_maxed = len(accumulated_chunks) >= MAX_PHRASE_CHUNKS

                if phrase_ready or phrase_maxed:
                    audio_to_transcribe = np.concatenate(accumulated_chunks, axis=0)
                    accumulated_chunks = []
                    silence_count = 0
                    state = "IDLE"
                    pre_roll = []
                    self._transcribe_audio(audio_to_transcribe)

        # Flush speech still buffered when listening stops
        if state == "SPEAKING" and len(accumulated_chunks) >= MIN_SPEECH_CHUNKS:
            try:
                self._transcribe_audio(np.concatenate(accumulated_chunks, axis=0))
            except Exception:
                pass


def main():
    host = WhisperHost()
    if not host.init_model():
        sys.exit(1)

    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                break
            cmd = line.strip()
            if not cmd:
                continue

            cmd_upper = cmd.upper()
            if cmd_upper == "QUIT":
                break
            elif cmd_upper == "START":
                host.start_listening()
            elif cmd_upper == "STOP":
                host.stop_listening()
            elif cmd_upper == "MODE:CONTROL":
                host.set_mode("control")
            elif cmd_upper == "MODE:DICTATION":
                host.set_mode("dictation")
            elif cmd_upper == "PING":
                emit("PONG")
        except (KeyboardInterrupt, SystemExit):
            break
        except Exception as exc:
            log_err(traceback.format_exc())
            emit("ERR_B64:" + to_b64(str(exc)))

    host.stop_listening()


if __name__ == "__main__":
    main()
