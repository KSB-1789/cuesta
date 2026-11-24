"""Download and warm the local Whisper model used by Cuesta's speech worker."""

import sys


def main() -> int:
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("faster-whisper is not installed. Run: pip install faster-whisper sounddevice numpy")
        return 1

    model_name = sys.argv[1] if len(sys.argv) > 1 else "small.en"
    print(f"Downloading and loading Whisper model: {model_name}")
    WhisperModel(model_name, device="cpu", compute_type="int8")
    print(f"Whisper model ready: {model_name}")
    print("Cuesta will now start dictation with the neural engine.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
