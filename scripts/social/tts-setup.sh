#!/usr/bin/env bash
# Installs the Reel voice-over engine (Kokoro v1.0 via kokoro-onnx) into $SOCIAL_TTS_DIR (default ~/.cache/rayvalue-tts):
# a Python venv plus the two model files (~340 MB), downloads resumable and checked against size + sha256.
# Safe to re-run: finished pieces are kept. scripts/social/audio.ts uses whatever is here; without it Reels get music only.
set -euo pipefail

DIR="${SOCIAL_TTS_DIR:-$HOME/.cache/rayvalue-tts}"
BASE="https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
mkdir -p "$DIR"

if [ ! -x "$DIR/venv/bin/python" ] || ! "$DIR/venv/bin/python" -I -c 'import kokoro_onnx, soundfile' 2>/dev/null; then
  python3 -m venv "$DIR/venv"
  "$DIR/venv/bin/python" -m pip install --quiet --upgrade pip
  "$DIR/venv/bin/python" -m pip install --quiet 'kokoro-onnx==0.6.1' 'soundfile==0.14.0'
fi

sha() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
size() { stat -c %s "$1" 2>/dev/null || stat -f %z "$1"; }

fetch() { # name bytes sha256
  local f="$DIR/$1"
  if [ -f "$f" ] && [ "$(size "$f")" = "$2" ] && [ "$(sha "$f")" = "$3" ]; then return 0; fi
  if [ -f "$f" ] && [ "$(size "$f")" -ge "$2" ]; then rm -f "$f"; fi # complete-but-wrong or oversized: start over
  for i in $(seq 1 20); do
    curl -fsSL --retry 3 -C - -o "$f" "$BASE/$1" && break
    echo "retrying $1 ($i, $(size "$f" 2>/dev/null || echo 0) bytes so far)" >&2
    sleep 2
  done
  [ "$(size "$f")" = "$2" ] || { echo "$1: wrong size $(size "$f"), expected $2" >&2; exit 1; }
  [ "$(sha "$f")" = "$3" ] || { echo "$1: sha256 mismatch" >&2; rm -f "$f"; exit 1; }
}

# Keep in sync with TTS_FILES in scripts/social/audio.ts.
fetch kokoro-v1.0.onnx 325532387 7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5
fetch voices-v1.0.bin 28214398 bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d
echo "TTS ready in $DIR"
