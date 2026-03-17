import { useEffect, useRef, useState, useCallback } from 'react'
import type { VadWorkerRequest, VadWorkerResponse } from './vad.worker.types'
import type { TranscriptionWorkerRequest, TranscriptionWorkerResponse } from './stt.worker.types'

export type ChunkEntry = {
  id: number
  audio: Float32Array<ArrayBuffer>
  startTime: number
  duration: number
  vadLatencyMs: number
  text: string | null
  sttLatencyMs: number | null
}

export type InFlightChunk = {
  chunkId: number
  startTime: number
  duration: number
  enqueuedAt: number
  done: boolean
  completedAt: number | null
}

export type WorkerStatus = {
  name: string
  ready: boolean
  inFlightChunks: InFlightChunk[]
}

export function useSttWorkerPipeline() {
  const vadWorkerRef = useRef<Worker | null>(null)
  const sttPoolRef = useRef<Worker[]>([])
  const sttQueueCountRef = useRef<number[]>([])
  const chunkWorkerMapRef = useRef<Map<number, number>>(new Map())
  const audioContextRef = useRef<AudioContext | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)

  const [ready, setReady] = useState(false)
  const [initializing, setInitializing] = useState(false)
  const [initProgress, setInitProgress] = useState<string[]>([])
  const [initError, setInitError] = useState<string | null>(null)
  const [listening, setListening] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [chunks, setChunks] = useState<ChunkEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [workerStatuses, setWorkerStatuses] = useState<WorkerStatus[]>([])

  const fileDoneRef = useRef<(() => void) | null>(null)
  const recordSampleRateRef = useRef(16000)
  const nextIdRef = useRef(0)

  // Track init state
  const vadReadyRef = useRef(false)
  const sttReadyRef = useRef<boolean[]>([])
  const poolSizeRef = useRef(0)

  // Track in-flight chunks per worker (ordered: first = processing, rest = queued)
  const sttInFlightRef = useRef<InFlightChunk[][]>([])

  function updateWorkerStatuses() {
    const statuses: WorkerStatus[] = [
      { name: 'VAD', ready: vadReadyRef.current, inFlightChunks: [] },
    ]
    for (let i = 0; i < poolSizeRef.current; i++) {
      statuses.push({
        name: `STT ${i + 1}`,
        ready: sttReadyRef.current[i] ?? false,
        inFlightChunks: [...(sttInFlightRef.current[i] ?? [])],
      })
    }
    setWorkerStatuses(statuses)
  }

  function checkReady() {
    const allSttReady = sttReadyRef.current.length === poolSizeRef.current &&
      sttReadyRef.current.every(Boolean)
    if (vadReadyRef.current && allSttReady) {
      setReady(true)
      setInitializing(false)
    }
    updateWorkerStatuses()
  }

  // Send a segment to the least-loaded STT worker
  const transcribeSegment = useCallback((chunkId: number, audio: Float32Array<ArrayBuffer>, startTime: number, duration: number) => {
    const pool = sttPoolRef.current
    const counts = sttQueueCountRef.current
    if (pool.length === 0) return
    let minIdx = 0
    for (let i = 1; i < counts.length; i++) {
      if (counts[i] < counts[minIdx]) minIdx = i
    }
    counts[minIdx]++
    chunkWorkerMapRef.current.set(chunkId, minIdx)
    sttInFlightRef.current[minIdx]?.push({ chunkId, startTime, duration, enqueuedAt: performance.now(), done: false, completedAt: null })
    updateWorkerStatuses()
    const msg: TranscriptionWorkerRequest = { type: 'transcribe', chunkId, audio, startTime, duration }
    pool[minIdx].postMessage(msg)
  }, [])

  // Add a VAD chunk and kick off transcription
  const addVadSegment = useCallback((audio: Float32Array<ArrayBuffer>, startTime: number, duration: number, vadLatencyMs: number) => {
    const id = nextIdRef.current++
    setChunks(prev => [...prev, { id, audio, startTime, duration, vadLatencyMs, text: null, sttLatencyMs: null }])
    transcribeSegment(id, audio, startTime, duration)
  }, [transcribeSegment])

  // Teardown all workers
  const teardown = useCallback(() => {
    vadWorkerRef.current?.terminate()
    vadWorkerRef.current = null
    sttPoolRef.current.forEach(w => w.terminate())
    sttPoolRef.current = []
    sttQueueCountRef.current = []
    sttInFlightRef.current = []
    sttReadyRef.current = []
    chunkWorkerMapRef.current.clear()
    vadReadyRef.current = false
    poolSizeRef.current = 0
    setReady(false)
    setWorkerStatuses([])
  }, [])

  // Create and init all workers
  const init = useCallback((modelUrl: string, poolSize: number) => {
    // Teardown existing workers first
    teardown()

    poolSizeRef.current = poolSize
    setInitializing(true)
    setInitProgress([])
    setInitError(null)
    setChunks([])
    nextIdRef.current = 0

    // Create VAD worker
    const vadWorker = new Worker(
      new URL('./vad.worker.ts', import.meta.url),
      { type: 'classic' },
    )
    vadWorkerRef.current = vadWorker

    vadWorker.onmessage = (event: MessageEvent<VadWorkerResponse>) => {
      const msg = event.data
      switch (msg.type) {
        case 'init-progress':
          setInitProgress(prev => [...prev, msg.message])
          break
        case 'init-done':
          vadReadyRef.current = true
          checkReady()
          break
        case 'init-error':
          setInitError(msg.error)
          setInitializing(false)
          break
        case 'vad-status':
          setSpeaking(msg.speaking)
          break
        case 'vad-segment':
          addVadSegment(msg.audio, msg.startTime, msg.duration, msg.vadEmittedAt - msg.audioReceivedAt)
          break
        case 'file-done':
          setTimeout(() => {
            setProcessing(false)
            fileDoneRef.current?.()
            fileDoneRef.current = null
          }, 500)
          break
        case 'error':
          setError(msg.error)
          setProcessing(false)
          break
      }
    }

    // Create STT worker pool
    sttReadyRef.current = new Array(poolSize).fill(false)
    sttInFlightRef.current = Array.from({ length: poolSize }, () => [] as InFlightChunk[])
    sttQueueCountRef.current = new Array(poolSize).fill(0)
    updateWorkerStatuses()

    const sttWorkers: Worker[] = []
    for (let i = 0; i < poolSize; i++) {
      const sttWorker = new Worker(
        new URL('./stt.worker.ts', import.meta.url),
        { type: 'module' },
      )

      sttWorker.onmessage = (event: MessageEvent<TranscriptionWorkerResponse>) => {
        const msg = event.data
        switch (msg.type) {
          case 'init-progress':
            setInitProgress(prev => [...prev, `[STT ${i + 1}] ${msg.message}`])
            break
          case 'init-done':
            sttReadyRef.current[i] = true
            checkReady()
            break
          case 'init-error':
            setInitError(msg.error)
            setInitializing(false)
            break
          case 'result': {
            const workerIdx = chunkWorkerMapRef.current.get(msg.chunkId)
            if (workerIdx !== undefined) {
              sttQueueCountRef.current[workerIdx]--
              const arr = sttInFlightRef.current[workerIdx]
              if (arr) {
                const entry = arr.find(c => c.chunkId === msg.chunkId)
                if (entry) { entry.done = true; entry.completedAt = performance.now() }
              }
              chunkWorkerMapRef.current.delete(msg.chunkId)
            }
            setChunks(prev => prev.map(c =>
              c.id === msg.chunkId ? { ...c, text: msg.text, sttLatencyMs: msg.latencyMs } : c
            ))
            updateWorkerStatuses()
            break
          }
        }
      }

      sttWorker.postMessage({ type: 'init', modelUrl } satisfies TranscriptionWorkerRequest)
      sttWorkers.push(sttWorker)
    }
    sttPoolRef.current = sttWorkers

    // Start VAD init in parallel
    vadWorker.postMessage({ type: 'init' } satisfies VadWorkerRequest)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teardown, addVadSegment])

  // Cleanup on unmount
  useEffect(() => {
    return () => teardown()
  }, [teardown])

  // Feed raw audio samples to the VAD worker (same path as mic input)
  const feedAudio = useCallback((samples: Float32Array) => {
    if (!vadWorkerRef.current) return
    const msg: VadWorkerRequest = { type: 'audio', samples }
    vadWorkerRef.current.postMessage(msg, [samples.buffer as ArrayBuffer])
  }, [])

  // Flush VAD state (emits any remaining segment) and signal stop
  const flushVad = useCallback(() => {
    vadWorkerRef.current?.postMessage({ type: 'stop' } satisfies VadWorkerRequest)
  }, [])

  const resetState = useCallback(() => {
    setChunks([])
    nextIdRef.current = 0
    sttQueueCountRef.current.fill(0)
    sttInFlightRef.current.forEach(a => a.length = 0)
    chunkWorkerMapRef.current.clear()
    setError(null)
    updateWorkerStatuses()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const start = useCallback(async () => {
    if (!vadWorkerRef.current || !ready) return

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream

      const audioCtx = new AudioContext({ sampleRate: 16000 })
      audioContextRef.current = audioCtx
      recordSampleRateRef.current = audioCtx.sampleRate

      const source = audioCtx.createMediaStreamSource(stream)
      sourceRef.current = source

      const processor = audioCtx.createScriptProcessor(4096, 1, 1)
      processorRef.current = processor

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0)
        const rawSamples = new Float32Array(inputData)
        const samples = recordSampleRateRef.current !== 16000
          ? downsample(rawSamples, recordSampleRateRef.current, 16000)
          : rawSamples
        const msg: VadWorkerRequest = { type: 'audio', samples }
        vadWorkerRef.current?.postMessage(msg, [samples.buffer as ArrayBuffer])
      }

      source.connect(processor)
      processor.connect(audioCtx.destination)

      setListening(true)
      resetState()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [ready, resetState])

  const stop = useCallback(() => {
    vadWorkerRef.current?.postMessage({ type: 'stop' } satisfies VadWorkerRequest)

    if (processorRef.current && sourceRef.current) {
      processorRef.current.disconnect()
      sourceRef.current.disconnect()
    }
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop())
      mediaStreamRef.current = null
    }

    processorRef.current = null
    sourceRef.current = null
    setListening(false)
    setSpeaking(false)
  }, [])

  const processFile = useCallback((samples: Float32Array): Promise<void> => {
    if (!vadWorkerRef.current || !ready) {
      return Promise.reject(new Error('Worker not ready'))
    }

    resetState()
    setProcessing(true)

    return new Promise<void>((resolve) => {
      fileDoneRef.current = resolve
      const msg: VadWorkerRequest = { type: 'process-file', samples }
      vadWorkerRef.current!.postMessage(msg, [samples.buffer as ArrayBuffer])
    })
  }, [ready, resetState])

  return {
    ready,
    initializing,
    initProgress,
    initError,
    listening,
    speaking,
    processing,
    chunks,
    error,
    workerStatuses,
    init,
    start,
    stop,
    processFile,
    feedAudio,
    flushVad,
    resetState,
  }
}

function downsample(buffer: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return buffer
  const ratio = fromRate / toRate
  const newLength = Math.round(buffer.length / ratio)
  const result = new Float32Array(newLength)
  for (let i = 0; i < newLength; i++) {
    const nextOffset = Math.round((i + 1) * ratio)
    const offset = Math.round(i * ratio)
    let accum = 0
    let count = 0
    for (let j = offset; j < nextOffset && j < buffer.length; j++) {
      accum += buffer[j]
      count++
    }
    result[i] = accum / count
  }
  return result
}
