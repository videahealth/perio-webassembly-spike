#!/bin/bash
source /build/src/env.sh
echo "=== Building Kaldi ==="
git clone --depth=1 https://github.com/kaldi-asr/kaldi "$KALDI"
cd "$KALDI"/src
CXXFLAGS="$SHARED_FLAGS -I$OPENBLAS/include -UHAVE_EXECINFO_H -DEMSCRIPTEN_HAS_UNBOUND_TYPE_NAMES=0 -fwasm-exceptions -Wno-unused-variable -Wno-unused-but-set-variable" \
  LDFLAGS="-lembind" \
  emconfigure ./configure --use-cuda=no --with-cudadecoder=no --static --static-math=yes --static-fst=yes --fst-version=1.8.4 --debug-level=0 --fst-root="$OPENFST" --openblas-root="$OPENBLAS" --mathlib=OPENBLAS --host=WASM
emmake make -j"$JOBS" online2 rnnlm > /dev/null
