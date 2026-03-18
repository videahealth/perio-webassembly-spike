#!/bin/bash
source /build/src/env.sh
echo "=== Building OpenFST ==="
wget -q https://www.openfst.org/twiki/pub/FST/FstDownload/openfst-1.8.4.tar.gz -O /tmp/openfst.tgz
mkdir /tmp/openfst
tar -xzf /tmp/openfst.tgz -C /tmp/openfst --strip-component 1
cd /tmp/openfst
autoreconf -is
CXXFLAGS="$SHARED_FLAGS -O3 -fno-rtti" emconfigure ./configure --prefix="$OPENFST" --enable-static --disable-shared --enable-ngram-fsts --disable-bin
emmake make -j"$JOBS" install > /dev/null
rm -rf /tmp/openfst
