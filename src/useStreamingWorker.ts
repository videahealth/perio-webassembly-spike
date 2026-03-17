import { useEffect, useRef, useState, useCallback } from 'react'
import type { StreamingWorkerRequest, StreamingWorkerResponse } from './streaming.worker'

type RunState = {
  status: 'idle' | 'running'
  progress: string[]
  result: object | null
  error: string | null
}

export function useStreamingWorker() {
  const workerRef = useRef<Worker | null>(null)
  const [ready, setReady] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)
  const [run, setRun] = useState<RunState>({
    status: 'idle',
    progress: [],
    result: null,
    error: null,
  })

  useEffect(() => {
    const worker = new Worker(
      new URL('./streaming.worker.ts', import.meta.url),
      { type: 'module' },
    )
    workerRef.current = worker

    worker.onmessage = (event: MessageEvent<StreamingWorkerResponse>) => {
      const msg = event.data

      switch (msg.type) {
        case 'init-done':
          setReady(true)
          break
        case 'init-error':
          setInitError(msg.error)
          break
        case 'progress':
          setRun(prev => ({
            ...prev,
            progress: [...prev.progress, msg.message],
          }))
          break
        case 'result':
          setRun(prev => ({ ...prev, status: 'idle', result: msg.data }))
          break
        case 'error':
          setRun(prev => ({ ...prev, status: 'idle', error: msg.error }))
          break
      }
    }

    const initMsg: StreamingWorkerRequest = { type: 'init' }
    worker.postMessage(initMsg)

    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  const runCode = useCallback(() => {
    if (!workerRef.current) return
    setRun({ status: 'running', progress: [], result: null, error: null })
    const msg: StreamingWorkerRequest = { type: 'run' }
    workerRef.current.postMessage(msg)
  }, [])

  return { ready, initError, run, runCode }
}
