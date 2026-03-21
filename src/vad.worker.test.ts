/// <reference path="./vad.worker.types.d.ts" />
import { describe, it, expect, beforeAll } from 'vitest';
import { Worker } from 'worker_threads';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const WORKER_PATH = resolve(__dirname, 'vad.worker.ts');
const FIXTURE_30S = resolve(__dirname, '../test-fixtures/Recording-30s.wav');

function readWavAsFloat32(filePath: string): Float32Array {
  const buf = readFileSync(filePath);
  // Skip 44-byte WAV header, assume 16-bit PCM mono
  const pcm = new Int16Array(buf.buffer, buf.byteOffset + 44, (buf.length - 44) / 2);
  const float = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    float[i] = pcm[i] / 32768;
  }
  return float;
}

/** Strip binary audio data for snapshotting, keep everything else. */
function sanitize(messages: VadWorkerResponse[]) {
  return messages.map(m => {
    const clone = { ...m } as Record<string, unknown>;
    if ('audio' in clone) {
      clone.audioLength = (clone.audio as Float32Array).length;
      delete clone.audio;
    }
    delete clone.audioReceivedAt;
    delete clone.vadEmittedAt;
    return clone;
  });
}

function createVadWorker(): { worker: Worker; messages: VadWorkerResponse[]; waitFor: (type: string) => Promise<VadWorkerResponse> } {
  const messages: VadWorkerResponse[] = [];
  const listeners: Array<(msg: VadWorkerResponse) => void> = [];

  // Run worker as CJS so require/__dirname are available (package.json "type":"module" forces ESM otherwise)
  const worker = new Worker(
    `require('tsx/cjs'); require(${JSON.stringify(WORKER_PATH)});`,
    { eval: true },
  );

  worker.on('message', (msg: VadWorkerResponse) => {
    messages.push(msg);
    for (const fn of listeners.splice(0)) fn(msg);
  });

  function waitFor(type: string): Promise<VadWorkerResponse> {
    const existing = messages.find(m => m.type === type);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => {
      const check = (msg: VadWorkerResponse) => {
        if (msg.type === type) resolve(msg);
        else listeners.push(check);
      };
      listeners.push(check);
    });
  }

  return { worker, messages, waitFor };
}

describe('vad.worker', () => {
  let worker: Worker;
  let messages: VadWorkerResponse[];
  let waitFor: (type: string) => Promise<VadWorkerResponse>;

  beforeAll(async () => {
    const ctx = createVadWorker();
    worker = ctx.worker;
    messages = ctx.messages;
    waitFor = ctx.waitFor;

    worker.postMessage({ type: 'init' });
    await waitFor('init-done');
  }, 30_000);

  it('process-file produces deterministic VAD segments for Recording-30s.wav', async () => {
    const samples = readWavAsFloat32(FIXTURE_30S);
    messages.length = 0;

    worker.postMessage({ type: 'process-file', samples });
    await waitFor('file-done');

    expect(sanitize(messages)).toMatchSnapshot();
  }, 60_000);

  it('should handle stop cleanly', async () => {
    messages.length = 0;
    worker.postMessage({ type: 'stop' });

    await new Promise(r => setTimeout(r, 100));

    expect(messages.filter(m => m.type === 'error')).toHaveLength(0);
    await worker.terminate();
  });
});
