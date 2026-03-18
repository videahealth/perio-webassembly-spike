#!/bin/bash
set -euo pipefail
echo "=== Installing emsdk ==="
git clone --depth=1 https://github.com/emscripten-core/emsdk.git /build/emsdk
cd /build/emsdk
./emsdk install 4.0.13
./emsdk activate 4.0.13
