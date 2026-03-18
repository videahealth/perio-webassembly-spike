# vosk-wasm

Custom WebAssembly build of [Vosk](https://alphacephei.com/vosk/) for browser-based speech recognition. Designed to run inside a Web Worker with a minimal, synchronous API.

Build pipeline adapted from [Vosklet](https://github.com/msqr1/Vosklet) and [vosk-browser](https://github.com/ccoreilly/vosk-browser/forks).

## Build

Requires Docker.

```bash
bash make.sh
```

This builds inside a Linux Docker container, compiling each dependency as a cached layer:

1. Emscripten SDK 4.0.13
2. OpenFST 1.8.4 (speech decoding graphs)
3. OpenBLAS 0.3.30 (linear algebra for neural networks)
4. Kaldi (speech recognition toolkit)
5. Vosk 0.3.50 (speech recognition API)
6. vosk-wasm bindings (our C++/JS glue code)

Output: `vosk-wasm.js` and `vosk-wasm.wasm` in this directory.

If a step fails, Docker caches all prior steps — only the failed step and later ones re-run.

## Project structure

```
vosk-wasm/
├── make.sh                  # Entry point — runs Docker build, extracts artifacts
├── Dockerfile               # Each dependency is a separate cached layer
├── vosk-wasm.d.ts           # TypeScript definitions
├── vosk-wasm.js             # (generated) WASM module loader
├── vosk-wasm.wasm           # (generated) WASM binary
└── src/
    ├── env.sh               # Shared environment for all build steps
    ├── 1-emsdk/             # Emscripten SDK install
    ├── 2-openfst/           # OpenFST compilation
    ├── 3-openblas/          # OpenBLAS compilation + patch
    ├── 4-kaldi/             # Kaldi compilation
    ├── 5-vosk/              # Vosk compilation + patch
    └── 6-vosk-wasm/         # Our bindings (C++, JS, build script)
        ├── WasmModel.cc/h   # Model: tar extraction + vosk_model_new()
        ├── WasmRecognizer.cc/h  # Recognizer: accept waveform, get results
        ├── Bindings.cc      # Emscripten embind definitions
        ├── Wrapper.js       # JS API layer (handles WASM heap malloc/free)
        └── Util.cc/h        # USTAR tar parser
```

## Usage

```typescript
import loadVoskWasm from './vosk-wasm/vosk-wasm.js';

// 1. Load the WASM module
const vosk = await loadVoskWasm();

// 2. Fetch and decompress a model
const response = await fetch('model.tar.gz');
const decompressed = response.body.pipeThrough(new DecompressionStream('gzip'));
const tarBuffer = await new Response(decompressed).arrayBuffer();

// 3. Load the model from tar bytes
const model = vosk.createModel(tarBuffer);

// 4. Create a recognizer with grammar
const grammar = JSON.stringify(["hello", "world", "[unk]"]);
const recognizer = vosk.createRecognizer(model, 16000, grammar);

// 5. Feed audio data (Float32Array, values in range [-1, 1])
const result = recognizer.acceptWaveform(audioSamples);
console.log(JSON.parse(result));

// 6. Get final result when done
const final = recognizer.finalResult();
console.log(JSON.parse(final));

// 7. Clean up
recognizer.delete();
model.delete();
```

## API

See [vosk-wasm.d.ts](vosk-wasm.d.ts) for full TypeScript definitions.

- `loadVoskWasm()` — Load the WASM module
- `vosk.createModel(tarBuffer)` — Load a model from decompressed tar bytes
- `vosk.createRecognizer(model, sampleRate, grammar)` — Create a grammar-constrained recognizer
- `recognizer.acceptWaveform(float32Array)` — Feed audio, returns JSON result string
- `recognizer.finalResult()` — Force-finalize and get result
- `recognizer.reset()` — Reset for reuse
- `recognizer.setWords(true)` — Enable word-level timestamps
- `recognizer.delete()` / `model.delete()` — Free WASM memory
