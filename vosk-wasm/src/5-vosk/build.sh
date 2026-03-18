#!/bin/bash
source /build/src/env.sh
echo "=== Building Vosk ==="
git clone -b v0.3.50 --depth=1 https://github.com/alphacep/vosk-api "$VOSK"
cd "$VOSK"/src
git apply "$SRC"/5-vosk/Vosk.patch
voskFiles="recognizer.o language_model.o model.o spk_model.o vosk_api.o"
# shellcheck disable=SC2086
em++ $SHARED_FLAGS -DOPENFST_VER=10804 -fwasm-exceptions -Wno-deprecated -I. -I"$KALDI"/src -I"$OPENFST"/include ${voskFiles//.o/.cc} -c
emar -rcs vosk.a $voskFiles
rm -f $voskFiles
