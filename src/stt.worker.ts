/// <reference lib="webworker" />

// vosk-wasm.js is served from public/ — defines global `loadVoskWasm`
importScripts('/vosk-wasm.js')

interface VoskModel {
  findWord(word: string): number;
  delete(): void;
}

interface VoskRecognizer {
  acceptWaveform(audioData: Float32Array): boolean;
  finalResult(): string;
  reset(): void;
  setWords(words: boolean): void;
  delete(): void;
}

interface VoskWasm {
  createModel(tarBuffer: ArrayBuffer): VoskModel;
  createRecognizer(model: VoskModel, sampleRate: number, grammar: string): VoskRecognizer;
}

declare function loadVoskWasm(moduleArg?: Record<string, unknown>): Promise<VoskWasm>

type TranscriptionWorkerRequest =
  | { type: 'init'; modelUrl: string }
  | { type: 'transcribe'; chunkId: number; audio: Float32Array<ArrayBuffer>; startTime: number; duration: number }

type TranscriptionWorkerResponse =
  | { type: 'init-progress'; message: string }
  | { type: 'init-done' }
  | { type: 'init-error'; error: string }
  | { type: 'ready' }
  | { type: 'result'; chunkId: number; text: string; latencyMs: number }

// Same grammar as videa-desktop python-stt VoskSTT.PERIO_GRAMMAR
const PERIO_GRAMMAR = JSON.stringify([
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen", "twenty", "twenty one", "twenty two",
  "twenty three", "twenty four", "twenty five", "twenty six", "twenty seven",
  "twenty eight", "twenty nine", "thirty", "thirty one", "thirty two",
  "facial", "lingual", "buccal", "distal", "mesial", "interproximal", "all",
  "bleeding on", "furcation on", "plaque on", "mobility on", "suppuration on",
  "fornication", "fornication on", "fortification", "fortification on",
  "frustration", "frustration on", "occasion", "occasion on",
  "calculus", "calculus on", "calculate", "calculated", "calcified",
  "grade", "light", "mild", "medium", "moderate", "severe", "heavy",
  "undo", "cancel", "cancel last", "go back",
  "pause", "stop", "stop listening", "hold", "wait",
  "resume", "continue", "keep going",
  "repeat", "same", "again", "ditto",
  "jump", "jump to", "go to", "move to", "skip to",
  "skip", "next", "next tooth",
  "missing", "missing tooth", "listening",
  "recession", "receding", "reception",
  "gingival margin", "gingival", "gm",
  "probing depth", "probing", "pd", "pocket depth",
  "mucogingival junction", "mucogingival", "mgj",
  "begin recession", "begin reception", "begin receding",
  "begin gingival margin", "begin gingival",
  "begin mucogingival junction", "begin mucogingival", "begin mgj",
  "chart pd", "chart gm", "chart mgj",
  "jump recession", "jump reception", "jump gm", "jump pd", "jump mgj",
  "quadrant", "on",
  "to", "the", "and", "a",
  "[unk]",
])

let vosk: VoskWasm | null = null
let recognizer: VoskRecognizer | null = null

function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function post(msg: TranscriptionWorkerResponse) {
  self.postMessage(msg)
}

self.onmessage = async (event: MessageEvent<TranscriptionWorkerRequest>) => {
  const msg = event.data

  if (msg.type === 'init') {
    try {
      post({ type: 'init-progress', message: 'Loading vosk-wasm module...' })
      vosk = await loadVoskWasm()

      post({ type: 'init-progress', message: `Downloading model: ${msg.modelUrl}` })
      const response = await fetch(msg.modelUrl)
      if (!response.ok || !response.body) throw new Error(`Failed to fetch model: ${response.status}`)
      // Server sends Content-Encoding: gzip, so the browser already decompresses.
      const tarBuffer = await response.arrayBuffer()
      post({ type: 'init-progress', message: 'Loading model into Vosk...' })
      const model = vosk.createModel(tarBuffer)
      recognizer = vosk.createRecognizer(model, 16000, PERIO_GRAMMAR)
      post({ type: 'init-progress', message: 'Vosk model loaded' })
      post({ type: 'init-done' })
      post({ type: 'ready' })
    } catch (e) {
      post({ type: 'init-error', error: `Vosk model failed: ${e instanceof Error ? e.message : String(e)}` })
    }
    return
  }

  if (msg.type === 'transcribe') {
    if (!recognizer) return
    const { chunkId, audio, startTime, duration } = msg
    const label = `STT ${fmtTime(startTime)}–${fmtTime(startTime + duration)}`
    const markStart = `${label}-start`
    performance.mark(markStart)
    const submitTime = Date.now()

    // Feed audio, then finalize to get the result
    const acceptResult = recognizer.acceptWaveform(audio)
    console.log(`[stt] chunkId=${chunkId} audioLen=${audio.length} acceptWaveform returned:`, acceptResult)
    const resultJson = recognizer.finalResult()
    console.log(`[stt] chunkId=${chunkId} finalResult:`, resultJson)
    const text = JSON.parse(resultJson).text?.trim() || ''
    console.log(`[stt] chunkId=${chunkId} text: "${text}"`)

    performance.measure(label, markStart)
    post({ type: 'result', chunkId, text, latencyMs: Date.now() - submitTime })

    recognizer.reset()
    post({ type: 'ready' })
    return
  }
}
