import { useEffect, useRef, useState, useCallback } from 'react'
import type { WorkerRequest, WorkerResponse } from './pyodide.worker'

type RunState = {
  status: 'idle' | 'running'
  progress: string[]
  result: object | null
  error: string | null
}

export function usePyodideWorker() {
  const workerRef = useRef<Worker | null>(null)
  const [ready, setReady] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)
  const [run, setRun] = useState<RunState>({
    status: 'idle',
    progress: [],
    result: null,
    error: null,
  })

  // Stable ref for the current run resolve/reject so we can await runCode()
  const pendingRef = useRef<{
    resolve: (data: unknown) => void
    reject: (error: Error) => void
  } | null>(null)

  useEffect(() => {
    const worker = new Worker(
      new URL('./pyodide.worker.ts', import.meta.url),
      { type: 'module' },
    )
    workerRef.current = worker

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
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
          pendingRef.current?.resolve(msg.data)
          pendingRef.current = null
          break
        case 'error':
          setRun(prev => ({ ...prev, status: 'idle', error: msg.error }))
          pendingRef.current?.reject(new Error(msg.error))
          pendingRef.current = null
          break
      }
    }

    // Start initialization
    const initMsg: WorkerRequest = { type: 'init' }
    worker.postMessage(initMsg)

    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  const runCode = useCallback((code: string): Promise<unknown> => {
    if (!workerRef.current) {
      return Promise.reject(new Error('Worker not available'))
    }

    const id = crypto.randomUUID()

    setRun({ status: 'running', progress: [], result: null, error: null })

    const promise = new Promise<unknown>((resolve, reject) => {
      pendingRef.current = { resolve, reject }
    })

    const msg: WorkerRequest = { type: 'run', id, code }
    workerRef.current.postMessage(msg)

    return promise
  }, [])

  return { ready, initError, run, runCode }
}
