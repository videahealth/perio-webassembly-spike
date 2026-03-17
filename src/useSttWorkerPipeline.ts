import { useEffect, useRef, useState, useCallback } from 'react'
import type { VadWorkerRequest, VadWorkerResponse } from './vad.worker.types'
import type { TranscriptionWorkerRequest, TranscriptionWorkerResponse } from './stt.worker.types'

export type ChunkEntry = {
  id: number
  audio: Float32Array<ArrayBuffer>
  startTime: number
  duration: number
  vadLatencyMs: number
  sttEnqueuedAt: number
  text: string | null
  sttLatencyMs: number | null
  silence: boolean
}

export type InFlightChunk = {
  chunkId: number
  startTime: number
  duration: number
  enqueuedAt: number
  done: boolean
  completedAt: number | null
}

export type WorkerNodeStatus = {
  name: string
  ready: boolean
  inFlightChunks: InFlightChunk[]
}

export type PipelineStatus = {
  vad: WorkerNodeStatus
  queue: PendingChunk[]
  stt: WorkerNodeStatus[]
}

export type PendingChunk = {
  chunkId: number
  audio: Float32Array<ArrayBuffer>
  startTime: number
  duration: number
  enqueuedAt: number
}

export function useSttWorkerPipeline() {
  const vadWorkerRef = useRef<Worker | null>(null)
  const sttPoolRef = useRef<Worker[]>([])
  const sttBusyRef = useRef<boolean[]>([])
  const pendingQueueRef = useRef<PendingChunk[]>([])
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
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus>({
    vad: { name: 'VAD', ready: false, inFlightChunks: [] },
    queue: [],
    stt: [],
  })

  const fileDoneRef = useRef<(() => void) | null>(null)
  const fileDurationRef = useRef(0)
  const lastSegmentEndRef = useRef(0)
  const recordSampleRateRef = useRef(16000)
  const nextIdRef = useRef(0)

  // Track init state
  const vadReadyRef = useRef(false)
  const sttReadyRef = useRef<boolean[]>([])
  const poolSizeRef = useRef(0)

  // Track in-flight chunks per worker (ordered: first = processing, rest = queued)
  const sttInFlightRef = useRef<InFlightChunk[][]>([])

  function updateWorkerStatuses() {
    const stt: WorkerNodeStatus[] = []
    for (let i = 0; i < poolSizeRef.current; i++) {
      stt.push({
        name: `STT ${i + 1}`,
        ready: sttReadyRef.current[i] ?? false,
        inFlightChunks: [...(sttInFlightRef.current[i] ?? [])],
      })
    }
    setPipelineStatus({
      vad: { name: 'VAD', ready: vadReadyRef.current, inFlightChunks: [] },
      queue: [...pendingQueueRef.current],
      stt,
    })
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

  // Send a chunk directly to a specific worker
  function sendToWorker(workerIdx: number, item: PendingChunk) {
    sttBusyRef.current[workerIdx] = true
    chunkWorkerMapRef.current.set(item.chunkId, workerIdx)
    sttInFlightRef.current[workerIdx]?.push({
      chunkId: item.chunkId,
      startTime: item.startTime,
      duration: item.duration,
      enqueuedAt: item.enqueuedAt,
      done: false,
      completedAt: null,
    })
    updateWorkerStatuses()
    const msg: TranscriptionWorkerRequest = {
      type: 'transcribe',
      chunkId: item.chunkId,
      audio: item.audio,
      startTime: item.startTime,
      duration: item.duration,
    }
    sttPoolRef.current[workerIdx].postMessage(msg)
  }

  // Drain the queue into a specific worker that just became idle
  function getJobFromQueue(workerIdx: number) {
    const queue = pendingQueueRef.current
    if (queue.length === 0) return
    sendToWorker(workerIdx, queue.shift()!)
  }

  // Try to send directly to an idle worker; fall back to queue
  const transcribeSegment = useCallback((chunkId: number, audio: Float32Array<ArrayBuffer>, startTime: number, duration: number) => {
    const job: PendingChunk = { chunkId, audio, startTime, duration, enqueuedAt: performance.now() }
    const busy = sttBusyRef.current
    for (let i = 0; i < busy.length; i++) {
      if (!busy[i]) {
        sendToWorker(i, job)
        return
      }
    }
    pendingQueueRef.current.push(job)
    updateWorkerStatuses()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Insert a silence chunk for gaps between VAD segments
  function addSilenceChunk(startTime: number, duration: number) {
    if (duration < 0.05) return // skip trivially small gaps
    const id = nextIdRef.current++
    setChunks(prev => [...prev, { id, audio: new Float32Array(0) as Float32Array<ArrayBuffer>, startTime, duration, vadLatencyMs: 0, sttEnqueuedAt: 0, text: '', sttLatencyMs: null, silence: true }])
  }

  // Add a VAD chunk and kick off transcription
  const addVadSegment = useCallback((audio: Float32Array<ArrayBuffer>, startTime: number, duration: number, vadLatencyMs: number) => {
    // Fill gap since last segment
    const gap = startTime - lastSegmentEndRef.current
    if (gap > 0) {
      addSilenceChunk(lastSegmentEndRef.current, gap)
    }
    lastSegmentEndRef.current = startTime + duration

    const id = nextIdRef.current++
    const sttEnqueuedAt = performance.now()
    setChunks(prev => [...prev, { id, audio, startTime, duration, vadLatencyMs, sttEnqueuedAt, text: null, sttLatencyMs: null, silence: false }])
    transcribeSegment(id, audio, startTime, duration)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcribeSegment])

  // Teardown all workers
  const teardown = useCallback(() => {
    vadWorkerRef.current?.terminate()
    vadWorkerRef.current = null
    sttPoolRef.current.forEach(w => w.terminate())
    sttPoolRef.current = []
    sttBusyRef.current = []
    pendingQueueRef.current = []
    sttInFlightRef.current = []
    sttReadyRef.current = []
    chunkWorkerMapRef.current.clear()
    vadReadyRef.current = false
    poolSizeRef.current = 0
    setReady(false)
    setPipelineStatus({ vad: { name: 'VAD', ready: false, inFlightChunks: [] }, queue: [], stt: [] })
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
        case 'file-done': {
          // Trailing silence after last VAD segment
          const trailingGap = fileDurationRef.current - lastSegmentEndRef.current
          if (trailingGap > 0) {
            addSilenceChunk(lastSegmentEndRef.current, trailingGap)
          }
          setTimeout(() => {
            setProcessing(false)
            fileDoneRef.current?.()
            fileDoneRef.current = null
          }, 500)
        }
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
    sttBusyRef.current = new Array(poolSize).fill(false)
    pendingQueueRef.current = []
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
          case 'ready':
            sttBusyRef.current[i] = false
            getJobFromQueue(i)
            break
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
  // If totalDuration is provided, trailing silence will be added after flush completes
  const flushVad = useCallback((totalDuration?: number) => {
    vadWorkerRef.current?.postMessage({ type: 'stop' } satisfies VadWorkerRequest)
    if (totalDuration !== undefined) {
      // Delay to let flushed vad-segment messages arrive first
      setTimeout(() => {
        const trailingGap = totalDuration - lastSegmentEndRef.current
        if (trailingGap > 0) {
          addSilenceChunk(lastSegmentEndRef.current, trailingGap)
        }
      }, 200)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const resetState = useCallback(() => {
    setChunks([])
    nextIdRef.current = 0
    lastSegmentEndRef.current = 0
    fileDurationRef.current = 0
    pendingQueueRef.current = []
    sttBusyRef.current.fill(false)
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
    fileDurationRef.current = samples.length / 16000

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
    pipelineStatus,
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
