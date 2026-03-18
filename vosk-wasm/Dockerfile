FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    autoconf \
    automake \
    libtool \
    clang \
    curl \
    wget \
    git \
    python3 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

COPY src/env.sh /build/src/env.sh

COPY src/1-emsdk/ /build/src/1-emsdk/
RUN bash /build/src/1-emsdk/build.sh

COPY src/2-openfst/ /build/src/2-openfst/
RUN bash /build/src/2-openfst/build.sh

COPY src/3-openblas/ /build/src/3-openblas/
RUN bash /build/src/3-openblas/build.sh

COPY src/4-kaldi/ /build/src/4-kaldi/
RUN bash /build/src/4-kaldi/build.sh

COPY src/5-vosk/ /build/src/5-vosk/
RUN bash /build/src/5-vosk/build.sh

COPY src/6-vosk-wasm/ /build/src/6-vosk-wasm/
RUN bash /build/src/6-vosk-wasm/build.sh
