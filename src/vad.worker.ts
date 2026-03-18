/**
 * Web Worker that runs sherpa-onnx WASM for VAD only.
 * Speech segments are sent back to the main thread for ASR via vosk-browser.
 */

/* eslint-disable no-var */
declare function importScripts(...urls: string[]): void;

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

// Message types (duplicated here since classic workers can't use import/export)
type VadWorkerRequest =
  | { type: 'init' }
  | { type: 'audio'; samples: Float32Array<ArrayBufferLike> }
  | { type: 'stop' }
  | { type: 'process-file'; samples: Float32Array<ArrayBufferLike> }

type VadWorkerResponse =
  | { type: 'init-progress'; message: string }
  | { type: 'init-done' }
  | { type: 'init-error'; error: string }
  | { type: 'vad-status'; speaking: boolean }
  | { type: 'vad-segment'; audio: Float32Array<ArrayBuffer>; startTime: number; duration: number; audioReceivedAt: number; vadEmittedAt: number }
  | { type: 'file-done' }
  | { type: 'error'; error: string }

declare var Module: EmscriptenModule;

let vad: Vad | null = null;
let buffer: CircularBuffer | null = null;
let printed = false;
const SAMPLE_RATE = 16000;

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

function post(msg: VadWorkerResponse) {
  self.postMessage(msg);
}

function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function emitSegment(segment: { samples: Float32Array; start: number }) {
  const audio = new Float32Array(segment.samples);
  const duration = audio.length / SAMPLE_RATE;
  const startTime = segment.start / SAMPLE_RATE;
  const received = lookupAudioReceivedAt(segment.start);
  const vadEmittedAt = Date.now();

  const label = `VAD ${fmtTime(startTime)}–${fmtTime(startTime + duration)}`;
  performance.measure(label, { start: received.perfTime, end: performance.now() });

  post({ type: 'vad-segment', audio, startTime, duration, audioReceivedAt: received.time, vadEmittedAt });
}

function drainVad() {
  if (!vad) return;
  while (!vad.isEmpty()) {
    const segment = vad.front();
    vad.pop();
    emitSegment(segment);
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

self.onmessage = (event: MessageEvent<VadWorkerRequest>) => {
  const msg = event.data;

  if (msg.type === 'init') {
    post({ type: 'init-progress', message: 'Loading sherpa-onnx WASM (VAD)...' });

    try {
      (self as unknown as Record<string, unknown>).Module = {
        locateFile(path: string, _scriptDirectory: string) {
          return '/sherpa-onnx/' + path;
        },
        setStatus(status: string) {
          if (status) post({ type: 'init-progress', message: status });
        },
        onRuntimeInitialized() {
          try {
            post({ type: 'init-progress', message: 'Creating VAD...' });
            vad = createVad(Module, {
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
            });

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
    } catch (e) {
      post({ type: 'init-error', error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  if (msg.type === 'audio') {
    if (!vad || !buffer) return;
    recordAudioArrival(msg.samples.length);
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
    return;
  }
};
