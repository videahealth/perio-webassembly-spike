#!/bin/bash
set -euo pipefail
# Build vosk-wasm inside a Linux Docker container.
# Outputs vosk-wasm.js and vosk-wasm.wasm to public/.

cd "$(dirname "$0")"

PUBLIC_DIR="../public"

echo "=== Building vosk-wasm Docker image ==="
docker build -t vosk-wasm-builder .

echo "=== Extracting build artifacts ==="
CONTAINER_ID=$(docker create vosk-wasm-builder)
docker cp "$CONTAINER_ID:/build/output/vosk-wasm.js" "$PUBLIC_DIR/vosk-wasm.js"
docker cp "$CONTAINER_ID:/build/output/vosk-wasm.wasm" "$PUBLIC_DIR/vosk-wasm.wasm"
docker rm "$CONTAINER_ID" > /dev/null

echo "=== Done! ==="
ls -lh "$PUBLIC_DIR"/vosk-wasm.*
