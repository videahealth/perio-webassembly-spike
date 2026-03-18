#!/bin/bash
source /build/src/env.sh
echo "=== Building vosk-wasm ==="
cd "$SRC"/6-vosk-wasm
voskWasmFiles="Util.o WasmModel.o WasmRecognizer.o Bindings.o"
voskWasmFlags="$SHARED_FLAGS -fno-rtti -sSTRICT"
voskWasmLDFlags="-sWASMFS -sMODULARIZE -sTEXTDECODER=2 -sEVAL_CTORS=2 -sALLOW_UNIMPLEMENTED_SYSCALLS -sINITIAL_MEMORY=$INITIAL_MEMORY -sALLOW_MEMORY_GROWTH -sPOLYFILL=0 -sEXIT_RUNTIME=0 -sINVOKE_RUN=0 -sSUPPORT_LONGJMP=0 -sINCOMING_MODULE_JS_API=wasmMemory,instantiateWasm,wasm -sEXPORT_NAME=loadVoskWasm -sMALLOC=emmalloc -sENVIRONMENT=web,worker -L$KALDI/src -l:online2/kaldi-online2.a -l:decoder/kaldi-decoder.a -l:ivector/kaldi-ivector.a -l:gmm/kaldi-gmm.a -l:tree/kaldi-tree.a -l:feat/kaldi-feat.a -l:cudamatrix/kaldi-cudamatrix.a -l:lat/kaldi-lat.a -l:lm/kaldi-lm.a -l:rnnlm/kaldi-rnnlm.a -l:hmm/kaldi-hmm.a -l:nnet3/kaldi-nnet3.a -l:transform/kaldi-transform.a -l:matrix/kaldi-matrix.a -l:fstext/kaldi-fstext.a -l:util/kaldi-util.a -l:base/kaldi-base.a -L$OPENFST/lib -l:libfst.a -l:libfstngram.a -L$OPENBLAS -l:lib/libopenblas.a -L$VOSK/src -l:vosk.a -lembind --no-entry --pre-js Wrapper.js"

# Inject version from VERSION file into Wrapper.js
VOSK_WASM_VERSION=$(cat /build/src/6-vosk-wasm/VERSION 2>/dev/null || echo "unknown")
sed -i "1i console.log('[vosk-wasm] v${VOSK_WASM_VERSION}');" Wrapper.js

mkdir -p /build/output
# shellcheck disable=SC2086
em++ ${voskWasmFiles//.o/.cc} $voskWasmFlags -DEMSCRIPTEN_HAS_UNBOUND_TYPE_NAMES=0 -fno-exceptions -std=c++23 -c -I. -I"$VOSK"/src
# shellcheck disable=SC2086
em++ $voskWasmFiles $voskWasmFlags $voskWasmLDFlags -o /build/output/vosk-wasm.js
rm -f $voskWasmFiles
echo "=== Done! Output: /build/output/vosk-wasm.{js,wasm} ==="
