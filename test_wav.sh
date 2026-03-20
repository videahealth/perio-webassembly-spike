#!/bin/bash
set -euo pipefail
# Stream a WAV file through the real stt_websocket_server and print results.
#
# Usage: ./test_wav.sh /path/to/audio.wav

WAV_FILE="${1:?Usage: ./test_wav.sh <wav-file>}"
PORT=8766
PYTHON_STT_DIR="$(cd "$(dirname "$0")/../videa-desktop/apps/videa-desktop/python-stt" && pwd)"
VENV_PYTHON="$PYTHON_STT_DIR/.venv/bin/python"

if [ ! -f "$VENV_PYTHON" ]; then
  echo "Error: python-stt venv not found at $VENV_PYTHON" >&2
  exit 1
fi

cleanup() {
  if [ -n "${SERVER_PID:-}" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "Stopping server (PID $SERVER_PID)..." >&2
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Start the server in background
echo "Starting stt_websocket_server on port $PORT..." >&2
"$VENV_PYTHON" "$PYTHON_STT_DIR/stt_websocket_server.py" "$PORT" &
SERVER_PID=$!

# Wait for server to be ready (listen for websocket_ready on stdout)
# Since stdout is not piped in bg, just poll the port
echo "Waiting for server to start..." >&2
for i in $(seq 1 30); do
  if nc -z 127.0.0.1 "$PORT" 2>/dev/null; then
    echo "Server is listening on port $PORT" >&2
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "Server process died" >&2
    exit 1
  fi
  sleep 1
done

if ! nc -z 127.0.0.1 "$PORT" 2>/dev/null; then
  echo "Timed out waiting for server" >&2
  exit 1
fi

# Run the client
npx tsx test_wav_client.ts "$WAV_FILE" "ws://127.0.0.1:$PORT"
