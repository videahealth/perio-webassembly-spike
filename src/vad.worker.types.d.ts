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
