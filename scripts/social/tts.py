"""
Reel voice-over: Kokoro (kokoro-onnx, Apache-2.0 model) text -> WAV, one file per line, model loaded once.
Called by scripts/social/audio.ts with the TTS venv's python, run isolated (python -I).

  python -I tts.py <job.json>
  job.json: {"model": path, "voices": path, "voice": "af_heart", "speed": 1.0,
             "items": [{"text": "...", "out": "/abs/voice-01.wav"}, ...]}
  stdout:   [{"file": "/abs/voice-01.wav", "seconds": 3.42}, ...]   (same order as items)

`text` is already speakable (src/lib/social/gen/speech.ts): numbers, money and names are spelled out.
"""
import json
import sys

import soundfile as sf
from kokoro_onnx import Kokoro


def main() -> int:
    with open(sys.argv[1], encoding="utf-8") as fp:
        job = json.load(fp)
    kokoro = Kokoro(job["model"], job["voices"])
    out = []
    for item in job["items"]:
        audio, sample_rate = kokoro.create(item["text"], voice=job["voice"], speed=float(job["speed"]), lang="en-us")
        sf.write(item["out"], audio, sample_rate, subtype="PCM_16")
        out.append({"file": item["out"], "seconds": round(len(audio) / sample_rate, 3)})
    json.dump(out, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
