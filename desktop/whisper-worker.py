# Cuesta Resident Neural Dictation & Command Worker (faster-whisper)
# High-precision local neural ASR matching HeyClicky / Wispr Flow standards.
# Completely offline, CPU int8 quantized, zero SAPI5 / legacy speech dependencies.

import sys
import os
import time
import base64
import threading
import queue
import re
import numpy as np

# Force UTF-8 I/O
sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")

def to_b64(text: str) -> str:
    return base64.b64encode((text or "").encode("utf-8")).decode("ascii")

def emit(line: str):
    try:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()
    except Exception:
        pass

# Whisper hallucinations to discard on near-silent utterances
HALLUCINATIONS = {
    "thank you", "thanks for watching", "bye", "you",
    "thank you for watching", "so", "please subscribe", "like and subscribe",
}

SAMPLE_RATE = 16000
BLOCK_SIZE = 1600       # 100ms
SILENCE_PAUSE_CHUNKS = 7 # ~700ms silence ends an utterance
MIN_SPEECH_CHUNKS = 3    # at least 300ms
MAX_PHRASE_CHUNKS = 150  # max 15s per phrase before auto-segmenting
ENERGY_RMS_THRESH = 0.005
ENERGY_PEAK_THRESH = 0.018

# Meta commands that bypass dictation mode
META_COMMANDS = {
    "stop dictation", "dictation mode", "control mode", "command mode",
    "pause gestures", "pause all gestures", "resume gestures", "gestures on"
}

class WhisperHost:
    def __init__(self):
        self.model = None
        self.current_mode = "dictation" # "dictation" or "control"
        self.is_listening = False
        self.audio_queue = queue.Queue()
        self.stream = None
        self.sd = None
        self.worker_thread = None
        self.stop_event = threading.Event()
        self.lock = threading.Lock()

    def init_model(self):
        try:
            from faster_whisper import WhisperModel
            import sounddevice as sd
            self.sd = sd

            # Load Systran/faster-whisper-small (already cached locally)
            self.model = WhisperModel(
                "Systran/faster-whisper-small",
                device="cpu",
                compute_type="int8",
                cpu_threads=4
            )
            emit("READY")
            return True
        except Exception as e:
            emit(f"ERR_B64:{to_b64(f'Whisper init failed: {e}')}")
            return False

    def audio_callback(self, indata, frames, time_info, status):
        if not self.is_listening:
            return
        # Copy audio block to processing queue
        self.audio_queue.put(indata.copy().flatten())

    def start_listening(self):
        with self.lock:
            if self.is_listening:
                emit("STATUS:listening")
                return

            try:
                # Clean up any previous thread
                if self.worker_thread and self.worker_thread.is_alive():
                    try:
                        self.worker_thread.join(timeout=1.5)
                    except Exception:
                        pass
                    self.worker_thread = None

                # Flush existing queue
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
                    callback=self.audio_callback
                )
                self.stream.start()
                self.is_listening = True

                self.worker_thread = threading.Thread(target=self._process_audio_loop, daemon=True)
                self.worker_thread.start()

                emit("STATUS:listening")
            except Exception as e:
                self.is_listening = False
                emit(f"ERR_B64:{to_b64(f'Microphone error: {e}')}")

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

    def _is_speech_chunk(self, chunk: np.ndarray) -> bool:
        if len(chunk) == 0:
            return False
        rms = float(np.sqrt(np.mean(chunk ** 2)))
        peak = float(np.max(np.abs(chunk)))
        return (rms >= ENERGY_RMS_THRESH or peak >= ENERGY_PEAK_THRESH)

    def _transcribe_audio(self, audio_data: np.ndarray):
        if len(audio_data) < (SAMPLE_RATE * 0.25): # less than 250ms
            return

        peak = float(np.max(np.abs(audio_data)))
        rms = float(np.sqrt(np.mean(audio_data ** 2)))
        if peak < 0.012 and rms < 0.004:
            return # ambient background noise floor

        try:
            segments, info = self.model.transcribe(
                audio_data,
                language="en",
                beam_size=3,
                best_of=3,
                vad_filter=True,
                vad_parameters=dict(min_silence_duration_ms=400),
                condition_on_previous_text=False
            )
            raw_text = " ".join(seg.text for seg in segments).strip()
            if not raw_text:
                return

            cleaned = re.sub(r"\s+", " ", raw_text).strip()
            lower = cleaned.lower().strip(" .!?,")

            if (
                lower in HALLUCINATIONS
                or len(lower) == 0
                or lower.startswith("subtitles by")
                or lower.startswith("subtitle by")
                or lower.startswith("sous-titres")
            ):
                return

            # Check if meta command
            is_meta = any(lower == mc or lower.startswith(mc) for mc in META_COMMANDS)
            is_control = (self.current_mode == "control") or is_meta

            if is_control:
                emit(f"CMD_B64:{to_b64(cleaned)}")
            else:
                emit(f"FINAL_B64:{to_b64(cleaned)}")
        except Exception as e:
            # Non-fatal transcription error
            pass

    def _process_audio_loop(self):
        state = "IDLE"
        pre_roll = [] # circular buffer of 2 chunks (~200ms)
        accumulated_chunks = []
        silence_count = 0
        last_level_time = time.time()

        while not self.stop_event.is_set():
            try:
                chunk = self.audio_queue.get(timeout=0.1)
            except queue.Empty:
                continue

            # Emit audio level for UI volume meter
            now = time.time()
            if now - last_level_time >= 0.08:
                last_level_time = now
                rms = float(np.sqrt(np.mean(chunk ** 2)))
                level = int(min(100, max(0, rms * 500)))
                emit(f"LEVEL:{level}")

            has_speech = self._is_speech_chunk(chunk)

            if state == "IDLE":
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

                # Check if pause reached or phrase duration limit
                phrase_ready = (silence_count >= SILENCE_PAUSE_CHUNKS and len(accumulated_chunks) >= MIN_SPEECH_CHUNKS)
                phrase_maxed = (len(accumulated_chunks) >= MAX_PHRASE_CHUNKS)

                if phrase_ready or phrase_maxed:
                    # Finalize utterance
                    audio_to_transcribe = np.concatenate(accumulated_chunks, axis=0)
                    accumulated_chunks = []
                    silence_count = 0
                    state = "IDLE"
                    pre_roll = []
                    self._transcribe_audio(audio_to_transcribe)

        # Flush any remaining speech on stop
        if state == "SPEAKING" and len(accumulated_chunks) >= MIN_SPEECH_CHUNKS:
            try:
                audio_to_transcribe = np.concatenate(accumulated_chunks, axis=0)
                self._transcribe_audio(audio_to_transcribe)
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
        except Exception as e:
            emit(f"ERR_B64:{to_b64(str(e))}")

    host.stop_listening()


if __name__ == "__main__":
    main()
