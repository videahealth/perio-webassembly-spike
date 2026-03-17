import { useEffect, useRef, useState, useCallback } from 'react'
import type { ContinuousWorkerRequest, ContinuousWorkerResponse } from './continuous.worker'

export type LogEntry = {
  direction: 'sent' | 'received'
  payload: string
  timestamp: number
}

export function useContinuousWorker() {
  const workerRef = useRef<Worker | null>(null)
  const [ready, setReady] = useState(false)
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState<LogEntry[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const worker = new Worker(
      new URL('./continuous.worker.ts', import.meta.url),
      { type: 'module' },
    )
    workerRef.current = worker

    worker.onmessage = (event: MessageEvent<ContinuousWorkerResponse>) => {
      const msg = event.data

      switch (msg.type) {
        case 'init-done':
          setReady(true)
          break
        case 'init-error':
          setError(msg.error)
          break
        case 'started':
          setRunning(true)
          break
        case 'message':
          setLog(prev => [...prev, {
            direction: 'received',
            payload: msg.payload,
            timestamp: Date.now(),
          }])
          break
        case 'stopped':
          setRunning(false)
          break
        case 'error':
          setError(msg.error)
          setRunning(false)
          break
      }
    }

    const initMsg: ContinuousWorkerRequest = { type: 'init' }
    worker.postMessage(initMsg)

    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  const start = useCallback(() => {
    if (!workerRef.current) return
    setLog([])
    setError(null)
    const msg: ContinuousWorkerRequest = { type: 'start' }
    workerRef.current.postMessage(msg)
  }, [])

  const send = useCallback((payload: string) => {
    if (!workerRef.current) return
    setLog(prev => [...prev, {
      direction: 'sent',
      payload,
      timestamp: Date.now(),
    }])
    const msg: ContinuousWorkerRequest = { type: 'send', payload }
    workerRef.current.postMessage(msg)
  }, [])

  const stop = useCallback(() => {
    if (!workerRef.current) return
    const msg: ContinuousWorkerRequest = { type: 'stop' }
    workerRef.current.postMessage(msg)
  }, [])

  return { ready, running, log, error, start, send, stop }
}
