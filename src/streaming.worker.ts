import { loadPyodide, type PyodideInterface } from 'pyodide'

export type StreamingWorkerRequest =
  | { type: 'init' }
  | { type: 'run' }

export type StreamingWorkerResponse =
  | { type: 'init-done' }
  | { type: 'init-error'; error: string }
  | { type: 'progress'; message: string }
  | { type: 'result'; data: object }
  | { type: 'error'; error: string }

let pyodide: PyodideInterface | null = null

self.onmessage = async (event: MessageEvent<StreamingWorkerRequest>) => {
  const msg = event.data

  if (msg.type === 'init') {
    try {
      pyodide = await loadPyodide()
      self.postMessage({ type: 'init-done' } satisfies StreamingWorkerResponse)
    } catch (e) {
      self.postMessage({
        type: 'init-error',
        error: e instanceof Error ? e.message : String(e),
      } satisfies StreamingWorkerResponse)
    }
    return
  }

  if (msg.type === 'run') {
    if (!pyodide) {
      self.postMessage({ type: 'error', error: 'Pyodide not initialized' } satisfies StreamingWorkerResponse)
      return
    }

    try {
      pyodide.globals.set('send_progress', (message: string) => {
        self.postMessage({ type: 'progress', message } satisfies StreamingWorkerResponse)
      })

      const response = await fetch('/streaming_worker.py')
      const code = await response.text()
      const result = await pyodide.runPythonAsync(code)

      let data: object = {}
      if (result && typeof result === 'object' && 'toJs' in result) {
        data = (result as { toJs: () => object }).toJs()
      }

      self.postMessage({ type: 'result', data } satisfies StreamingWorkerResponse)
    } catch (e) {
      self.postMessage({
        type: 'error',
        error: e instanceof Error ? e.message : String(e),
      } satisfies StreamingWorkerResponse)
    }
  }
}
