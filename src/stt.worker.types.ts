export type TranscriptionWorkerRequest =
  | { type: 'init'; modelUrl: string }
  | { type: 'transcribe'; chunkId: number; audio: Float32Array<ArrayBuffer>; startTime: number; duration: number }

export type TranscriptionWorkerResponse =
  | { type: 'init-progress'; message: string }
  | { type: 'init-done' }
  | { type: 'init-error'; error: string }
  | { type: 'result'; chunkId: number; text: string; latencyMs: number }
