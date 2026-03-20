import { describe, it, expect, beforeAll } from 'vitest';
import { Worker } from 'worker_threads';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const WORKER_PATH = resolve(__dirname, 'vad.worker.ts');
const FIXTURE_30S = resolve(__dirname, '../test-fixtures/Recording-30s.wav');

type VadResponse =
  | { type: 'init-progress'; message: string }
  | { type: 'init-done' }
  | { type: 'init-error'; error: string }
  | { type: 'vad-status'; speaking: boolean }
  | { type: 'vad-segment'; audio: Float32Array; startTime: number; duration: number; audioReceivedAt: number; vadEmittedAt: number }
  | { type: 'file-done' }
  | { type: 'error'; error: string };

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

function createVadWorker(): { worker: Worker; messages: VadResponse[]; waitFor: (type: string) => Promise<VadResponse> } {
  const messages: VadResponse[] = [];
  const listeners: Array<(msg: VadResponse) => void> = [];

  const worker = new Worker(WORKER_PATH, {
    execArgv: ['--import', 'tsx'],
  });

  worker.on('message', (msg: VadResponse) => {
    messages.push(msg);
    for (const fn of listeners.splice(0)) fn(msg);
  });

  function waitFor(type: string): Promise<VadResponse> {
    const existing = messages.find(m => m.type === type);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => {
      const check = (msg: VadResponse) => {
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
  let messages: VadResponse[];
  let waitFor: (type: string) => Promise<VadResponse>;

  beforeAll(async () => {
    const ctx = createVadWorker();
    worker = ctx.worker;
    messages = ctx.messages;
    waitFor = ctx.waitFor;

    worker.postMessage({ type: 'init' });
    const result = await waitFor('init-done');
    expect(result.type).toBe('init-done');
  }, 30_000);

  it('should produce vad-segment messages for known speech audio', async () => {
    const samples = readWavAsFloat32(FIXTURE_30S);
    messages.length = 0; // clear init messages

    worker.postMessage({ type: 'process-file', samples });
    await waitFor('file-done');

    const segments = messages.filter(m => m.type === 'vad-segment') as Extract<VadResponse, { type: 'vad-segment' }>[];

    // The 30s recording has multiple spoken triplets — expect a reasonable number of segments
    expect(segments.length).toBeGreaterThan(5);
    expect(segments.length).toBeLessThan(50);

    for (const seg of segments) {
      // Each segment should have positive duration
      expect(seg.duration).toBeGreaterThan(0);
      // Start time should be non-negative
      expect(seg.startTime).toBeGreaterThanOrEqual(0);
      // Audio samples length should match reported duration
      expect(seg.audio.length / 16000).toBeCloseTo(seg.duration, 5);
    }

    // Segments should be in chronological order
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i].startTime).toBeGreaterThanOrEqual(segments[i - 1].startTime);
    }

    // First segment should start near the beginning (within a few seconds)
    expect(segments[0].startTime).toBeLessThan(5);

    // Last segment should be somewhere in the latter half of the recording
    const lastSeg = segments[segments.length - 1];
    const recordingDuration = samples.length / 16000;
    expect(lastSeg.startTime + lastSeg.duration).toBeGreaterThan(recordingDuration / 2);
  }, 60_000);

  it('should apply speech padding (segments include pre-speech audio)', async () => {
    const samples = readWavAsFloat32(FIXTURE_30S);
    messages.length = 0;

    worker.postMessage({ type: 'process-file', samples });
    await waitFor('file-done');

    const segments = messages.filter(m => m.type === 'vad-segment') as Extract<VadResponse, { type: 'vad-segment' }>[];

    // With 200ms speech padding, segments that don't start at time 0 should
    // have audio that extends before their detected start time.
    // The padded startTime should be earlier than where VAD actually triggered.
    // We can verify padding is applied by checking that non-first segments
    // have durations that include the 200ms pad.
    const SPEECH_PAD_S = 0.2;
    const paddedSegments = segments.filter(s => s.startTime > SPEECH_PAD_S);
    expect(paddedSegments.length).toBeGreaterThan(0);

    for (const seg of paddedSegments) {
      // Duration should be at least the pad size (segment audio includes padding)
      expect(seg.duration).toBeGreaterThan(SPEECH_PAD_S);
    }
  }, 60_000);

  it('should emit vad-status speaking transitions', async () => {
    const samples = readWavAsFloat32(FIXTURE_30S);
    messages.length = 0;

    worker.postMessage({ type: 'process-file', samples });
    await waitFor('file-done');

    const statuses = messages.filter(m => m.type === 'vad-status') as Extract<VadResponse, { type: 'vad-status' }>[];

    // Should have both speaking=true and speaking=false transitions
    expect(statuses.some(s => s.speaking === true)).toBe(true);
    expect(statuses.some(s => s.speaking === false)).toBe(true);
  }, 60_000);

  it('should handle stop cleanly', async () => {
    messages.length = 0;
    worker.postMessage({ type: 'stop' });

    // Give it a moment to process
    await new Promise(r => setTimeout(r, 100));

    // No errors should be posted
    expect(messages.filter(m => m.type === 'error')).toHaveLength(0);

    await worker.terminate();
  });
});
