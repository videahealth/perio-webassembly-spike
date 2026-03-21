/**
 * Web Worker that runs sherpa-onnx WASM for VAD only.
 * Speech segments are sent back to the main thread for ASR via vosk-browser.
*/

/// <reference path="./vad.worker.types.d.ts" />

/* eslint-disable no-var, @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
declare function importScripts(...urls: string[]): void;
declare var process: { versions?: { node?: string } } | undefined;
declare var __dirname: string;
declare var require: (id: string) => any;

interface EmscriptenModule {
  onRuntimeInitialized: () => void;
  locateFile: (path: string, scriptDirectory: string) => string;
  setStatus: (status: string) => void;
  _malloc: (size: number) => number;
  _free: (ptr: number) => void;
  _CopyHeap: (src: number, len: number, dst: number) => void;
  HEAPF32: Float32Array;
  HEAP32: Int32Array;
  setValue: (ptr: number, value: number | string, type: string) => void;
  getValue: (ptr: number, type: string) => number;
  lengthBytesUTF8: (str: string) => number;
  stringToUTF8: (str: string, ptr: number, maxBytes: number) => void;
  UTF8ToString: (ptr: number) => string;
}

declare class Vad {
  config: {
    sileroVad: { windowSize: number };
    tenVad: { windowSize: number; model: string };
  };
  acceptWaveform(samples: Float32Array): void;
  isDetected(): boolean;
  isEmpty(): boolean;
  front(): { samples: Float32Array; start: number };
  pop(): void;
  reset(): void;
  flush(): void;
}

declare class CircularBuffer {
  constructor(capacity: number, Module: EmscriptenModule);
  push(samples: Float32Array): void;
  get(startIndex: number, n: number): Float32Array;
  pop(n: number): void;
  size(): number;
  head(): number;
  reset(): void;
}

declare function createVad(Module: EmscriptenModule, config?: Record<string, unknown>): Vad;

declare var Module: EmscriptenModule;

let vad: Vad | null = null;
let buffer: CircularBuffer | null = null;
let printed = false;
const SAMPLE_RATE = 16000;

// Accumulates incoming audio. When VAD emits a segment, it may be late to
// activate. This lets us keep a buffer of audio from before VAD detected speech.
let preVadBuffer = new Float32Array(0);
let preVadBufferIdx = 0; // preVadBuffer is a sliding window over all audio - track its relative position

function bufferPreVadAudio(samples: Float32Array) {
  const next = new Float32Array(preVadBuffer.length + samples.length);
  next.set(preVadBuffer);
  next.set(samples, preVadBuffer.length);
  preVadBuffer = next;
}

/** Prepends up to SPEECH_PAD_SAMPLES of pre-VAD audio to the VAD segment, then clears the buffer. */
const SPEECH_PAD_SAMPLES = SAMPLE_RATE; // 1 second (16000 samples)
function prependPreVadAudio(vadSegment: { samples: Float32Array; start: number }): { audio: Float32Array<ArrayBuffer>; start: number } {
  const relativeVadStart = Math.max(0, Math.min(vadSegment.start - preVadBufferIdx, preVadBuffer.length))
  const uniqueAudio = preVadBuffer.subarray(0, relativeVadStart);
  const prefixAudio = uniqueAudio.subarray(Math.max(0, uniqueAudio.length - SPEECH_PAD_SAMPLES));

  const audio = new Float32Array(prefixAudio.length + vadSegment.samples.length);
  audio.set(prefixAudio, 0);
  audio.set(vadSegment.samples, prefixAudio.length);

  preVadBufferIdx += preVadBuffer.length;
  preVadBuffer = new Float32Array(0);

  return { audio, start: Math.max(0, vadSegment.start - prefixAudio.length) };
}

function resetPreVadAudio() {
  preVadBuffer = new Float32Array(0);
  preVadBufferIdx = 0;
}

// Track when audio samples were received, keyed by cumulative sample offset
const audioTimestamps: Array<{ offset: number; time: number; perfTime: number }> = [];
let totalSamplesReceived = 0;

function recordAudioArrival(numSamples: number) {
  audioTimestamps.push({ offset: totalSamplesReceived, time: Date.now(), perfTime: performance.now() });
  totalSamplesReceived += numSamples;
}

function resetAudioTimestamps() {
  audioTimestamps.length = 0;
  totalSamplesReceived = 0;
}

function lookupAudioReceivedAt(sampleOffset: number): { time: number; perfTime: number } {
  // Find the last timestamp entry at or before this sample offset
  let best = { time: audioTimestamps[0]?.time ?? Date.now(), perfTime: audioTimestamps[0]?.perfTime ?? performance.now() };
  for (const entry of audioTimestamps) {
    if (entry.offset <= sampleOffset) best = { time: entry.time, perfTime: entry.perfTime };
    else break;
  }
  return best;
}

const IS_NODE = typeof process === 'object' && typeof process.versions?.node === 'string';

function post(msg: VadWorkerResponse) {
  if (IS_NODE) {
    require('worker_threads').parentPort.postMessage(msg);
  } else {
    self.postMessage(msg);
  }
}

function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function createVadSegment(segment: { samples: Float32Array; start: number }) {
  const { audio, start } = prependPreVadAudio(segment);
  const duration = audio.length / SAMPLE_RATE;
  const startTime = start / SAMPLE_RATE;
  const received = lookupAudioReceivedAt(start);
  const vadEmittedAt = Date.now();

  const label = `VAD ${fmtTime(startTime)}–${fmtTime(startTime + duration)}`;
  if (!IS_NODE) performance.measure(label, { start: received.perfTime, end: performance.now() });

  post({ type: 'vad-segment', audio, startTime, duration, audioReceivedAt: received.time, vadEmittedAt });
}

function drainVad() {
  if (!vad) return;
  while (!vad.isEmpty()) {
    const segment = vad.front();
    vad.pop();
    createVadSegment(segment);
  }
}

function processBuffer() {
  if (!vad || !buffer) return;
  const windowSize = vad.config.sileroVad.windowSize;

  while (buffer.size() > windowSize) {
    const samples = buffer.get(buffer.head(), windowSize);
    buffer.pop(windowSize);
    vad.acceptWaveform(samples);

    if (vad.isDetected() && !printed) {
      printed = true;
      post({ type: 'vad-status', speaking: true });
    }
    if (!vad.isDetected()) {
      if (printed) post({ type: 'vad-status', speaking: false });
      printed = false;
    }

    drainVad();
  }
}

const VAD_CONFIG = {
  sileroVad: {
    model: './silero_vad.onnx',
    threshold: 0.65,
    minSilenceDuration: 0.30,
    minSpeechDuration: 0.25,
    maxSpeechDuration: 5,
    windowSize: 512,
  },
  tenVad: {
    model: '',
    threshold: 0.5,
    minSilenceDuration: 0.5,
    minSpeechDuration: 0.25,
    maxSpeechDuration: 5,
    windowSize: 256,
  },
  sampleRate: 16000,
  numThreads: 1,
  provider: 'cpu',
  debug: 0,
  bufferSizeInSeconds: 60,
};

function handleMessage(msg: VadWorkerRequest) {
  if (msg.type === 'init') {
    post({ type: 'init-progress', message: 'Loading sherpa-onnx WASM (VAD)...' });

    try {
      if (IS_NODE) {
        const path = require('path');
        const sherpaDir = path.resolve(__dirname, '../public/sherpa-onnx');

        // Emscripten expects Module on globalThis before the script runs
        (globalThis as Record<string, unknown>).Module = {
          locateFile(p: string) { return path.join(sherpaDir, p); },
          setStatus(status: string) { if (status) post({ type: 'init-progress', message: status }); },
          onRuntimeInitialized() {
            try {
              post({ type: 'init-progress', message: 'Creating VAD...' });
              vad = createVad(Module, VAD_CONFIG);
              buffer = new CircularBuffer(30 * SAMPLE_RATE, Module);
              post({ type: 'init-done' });
            } catch (e) {
              post({ type: 'init-error', error: e instanceof Error ? e.message : String(e) });
            }
          },
        };

        // Must run scripts in global scope (like importScripts) so they see globalThis.Module
        const vm = require('vm');
        const fs = require('fs');
        vm.runInThisContext(fs.readFileSync(path.join(sherpaDir, 'sherpa-onnx-wasm-main-vad-asr.js'), 'utf8'));
        vm.runInThisContext(fs.readFileSync(path.join(sherpaDir, 'sherpa-onnx-vad.js'), 'utf8'));
      } else {
        (self as unknown as Record<string, unknown>).Module = {
          locateFile(p: string, _scriptDirectory: string) {
            return '/sherpa-onnx/' + p;
          },
          setStatus(status: string) {
            if (status) post({ type: 'init-progress', message: status });
          },
          onRuntimeInitialized() {
            try {
              post({ type: 'init-progress', message: 'Creating VAD...' });
              vad = createVad(Module, VAD_CONFIG);

              post({ type: 'init-progress', message: 'Creating audio buffer...' });
              buffer = new CircularBuffer(30 * SAMPLE_RATE, Module);

              post({ type: 'init-done' });
            } catch (e) {
              post({ type: 'init-error', error: e instanceof Error ? e.message : String(e) });
            }
          },
        };

        importScripts('/sherpa-onnx/sherpa-onnx-wasm-main-vad-asr.js');
        importScripts('/sherpa-onnx/sherpa-onnx-vad.js');
      }
    } catch (e) {
      post({ type: 'init-error', error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  if (msg.type === 'audio') {
    if (!vad || !buffer) return;
    recordAudioArrival(msg.samples.length);
    bufferPreVadAudio(msg.samples);
    buffer.push(msg.samples);
    processBuffer();
    return;
  }

  if (msg.type === 'process-file') {
    if (!vad || !buffer) {
      post({ type: 'error', error: 'Not initialized' });
      return;
    }

    vad.reset();
    buffer.reset();
    printed = false;
    resetAudioTimestamps();
    resetPreVadAudio();

    const allSamples = msg.samples;
    // Match videa-desktop AudioWorklet: 128-sample chunks
    const chunkSize = 128;
    // Process in small batches, yielding between each so vad-segment messages
    // reach the main thread and transcription can start in parallel.
    const batchSize = 16; // ~65k samples (~4s at 16kHz) per batch
    let offset = 0;

    function processBatch() {
      if (!vad || !buffer) return;
      const batchEnd = Math.min(offset + chunkSize * batchSize, allSamples.length);
      while (offset < batchEnd) {
        const end = Math.min(offset + chunkSize, allSamples.length);
        recordAudioArrival(end - offset);
        const chunk = new Float32Array(allSamples.buffer, allSamples.byteOffset + offset * 4, end - offset);
        bufferPreVadAudio(chunk);
        buffer.push(chunk);
        processBuffer();
        offset = end;
      }

      if (offset < allSamples.length) {
        setTimeout(processBatch, 0);
      } else {
        vad.flush();
        drainVad();
        vad.reset();
        buffer.reset();
        post({ type: 'file-done' });
      }
    }

    processBatch();
    return;
  }

  if (msg.type === 'stop') {
    if (vad) {
      vad.flush();
      drainVad();
      vad.reset();
    }
    if (buffer) buffer.reset();
    printed = false;
    resetAudioTimestamps();
    resetPreVadAudio();
    return;
  }
}

if (IS_NODE) {
  const { parentPort } = require('worker_threads');
  parentPort.on('message', (msg: VadWorkerRequest) => handleMessage(msg));
} else {
  self.onmessage = (event: MessageEvent<VadWorkerRequest>) => handleMessage(event.data);
}
