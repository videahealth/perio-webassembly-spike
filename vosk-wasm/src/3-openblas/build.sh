#!/bin/bash
source /build/src/env.sh
echo "=== Building OpenBLAS ==="
git clone -b v0.3.30 https://github.com/OpenMathLib/OpenBLAS --depth=1 /tmp/openblas
cd /tmp/openblas
git apply "$SRC"/3-openblas/OpenBLAS.patch
openblasFlags="CC=emcc HOSTCC=clang TARGET=RISCV64_GENERIC USE_THREAD=0 NO_SHARED=1 BINARY=32 NOFORTRAN=1 BUILD_SINGLE=1 BUILD_DOUBLE=1 BUILD_BFLOAT16=0 BUILD_COMPLEX16=0 BUILD_COMPLEX=0"
openblasCFlags="$SHARED_FLAGS -fno-exceptions -fno-rtti -w"
# shellcheck disable=SC2086
make -s $openblasFlags CFLAGS="$openblasCFlags" PREFIX="$OPENBLAS" -j"$JOBS" 2>&1 | grep -v "forced in submake"
# shellcheck disable=SC2086
make -s $openblasFlags CFLAGS="$openblasCFlags" PREFIX="$OPENBLAS" -j"$JOBS" install 2>&1 | grep -v "forced in submake"
rm -rf /tmp/openblas
