#!/usr/bin/env python3
"""
Run the full VAD → STT → normalizer pipeline on an arbitrary WAV file.

Usage:
    source ../videa-desktop/apps/videa-desktop/python-stt/.venv/bin/activate
    python test_wav_client.py /path/to/audio.wav
"""

import json
import sys
from pathlib import Path

# Add python-stt to sys.path so we can import its modules and use its venv
_PYTHON_STT_DIR = str(Path(__file__).resolve().parent / ".." / "videa-desktop" / "apps" / "videa-desktop" / "python-stt")
sys.path.insert(0, _PYTHON_STT_DIR)

from test_audio_fixtures import _run_multi_command_pipeline
from transcribe_wav import find_model_path
from vosk import Model


def main():
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <wav-file>", file=sys.stderr)
        sys.exit(1)

    wav_path = Path(sys.argv[1])
    if not wav_path.is_file():
        print(f"File not found: {wav_path}", file=sys.stderr)
        sys.exit(1)

    model_path = find_model_path(auto_download=False)
    print(f"Model: {model_path}", file=sys.stderr)
    model = Model(model_path)

    commands = _run_multi_command_pipeline(wav_path, model)
    print(json.dumps(commands, indent=2))


if __name__ == "__main__":
    main()
