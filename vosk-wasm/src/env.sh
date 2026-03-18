#!/bin/bash
# Shared environment for all build steps.
set -euo pipefail

INITIAL_MEMORY="315mb"
JOBS=$(nproc)
EMSDK="/build/emsdk"
SRC="/build/src"
KALDI="/build/kaldi"
VOSK="/build/vosk"
OPENFST="/build/openfst"
OPENBLAS="/build/openblas"
SHARED_FLAGS="-g0 -O3 -flto -msimd128 -matomics -mreference-types -mextended-const -msign-ext -mmutable-globals"

. "$EMSDK"/emsdk_env.sh
export PATH=$PATH:"$EMSDK"/upstream/bin
