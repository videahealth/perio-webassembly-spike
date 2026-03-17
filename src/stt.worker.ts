import { createModel, type Model, type KaldiRecognizer } from 'vosk-browser'
import type { TranscriptionWorkerRequest, TranscriptionWorkerResponse } from './stt.worker.types'

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

let model: Model | null = null
// Pre-create next recognizer while current one is processing
let nextRecognizer: KaldiRecognizer | null = null

function createRecognizer(): KaldiRecognizer | null {
  if (!model) return null
  return new model.KaldiRecognizer(16000, PERIO_GRAMMAR)
}

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
      post({ type: 'init-progress', message: `Loading Vosk model: ${msg.modelUrl}` })
      model = await createModel(msg.modelUrl)
      nextRecognizer = createRecognizer()
      post({ type: 'init-progress', message: 'Vosk model loaded' })
      post({ type: 'init-done' })
      post({ type: 'ready' })
    } catch (e) {
      post({ type: 'init-error', error: `Vosk model failed: ${e instanceof Error ? e.message : String(e)}` })
    }
    return
  }

  if (msg.type === 'transcribe') {
    if (!model) return
    const { chunkId, audio, startTime, duration } = msg
    const label = `STT ${fmtTime(startTime)}–${fmtTime(startTime + duration)}`
    const markStart = `${label}-start`
    performance.mark(markStart)
    const submitTime = Date.now()

    // Use pre-created recognizer, or create one if not available
    const recognizer = nextRecognizer ?? createRecognizer()
    if (!recognizer) return

    // Pre-create the next recognizer while this one processes
    nextRecognizer = createRecognizer()

    recognizer.on('result', (message) => {
      if (message.event !== 'result') return
      const text = message.result.text?.trim() || ''
      performance.measure(label, markStart)
      post({ type: 'result', chunkId, text, latencyMs: Date.now() - submitTime })
      recognizer.remove()
      post({ type: 'ready' })
    })

    recognizer.acceptWaveformFloat(audio, 16000)
    recognizer.retrieveFinalResult()
    return
  }
}
