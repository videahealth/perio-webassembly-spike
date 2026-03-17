import { loadPyodide, type PyodideInterface } from 'pyodide'

export type WorkerRequest =
  | { type: 'init' }
  | { type: 'run'; id: string; code: string }

export type WorkerResponse =
  | { type: 'init-done' }
  | { type: 'init-error'; error: string }
  | { type: 'progress'; id: string; message: string }
  | { type: 'result'; id: string; data: object }
  | { type: 'error'; id: string; error: string }

let pyodide: PyodideInterface | null = null

/**
 * Send a progress message back to the main thread.
 * This function is exposed to Python as `send_progress(msg)`.
 */
function sendProgress(id: string, message: string) {
  const response: WorkerResponse = { type: 'progress', id, message }
  self.postMessage(response)
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data

  if (msg.type === 'init') {
    try {
      pyodide = await loadPyodide()
      const response: WorkerResponse = { type: 'init-done' }
      self.postMessage(response)
    } catch (e) {
      const response: WorkerResponse = {
        type: 'init-error',
        error: e instanceof Error ? e.message : String(e),
      }
      self.postMessage(response)
    }
    return
  }

  if (msg.type === 'run') {
    if (!pyodide) {
      const response: WorkerResponse = {
        type: 'error',
        id: msg.id,
        error: 'Pyodide not initialized',
      }
      self.postMessage(response)
      return
    }

    try {
      // Expose send_progress to Python so the script can report progress
      pyodide.globals.set('send_progress', (message: string) => {
        sendProgress(msg.id, message)
      })

      const result = await pyodide.runPythonAsync(msg.code)

      // Convert PyProxy to JS if needed
      let data: object = {}
      if (result && typeof result === 'object' && 'toJs' in result) {
        data = (result as { toJs: () => object }).toJs()
      }

      const response: WorkerResponse = { type: 'result', id: msg.id, data }
      self.postMessage(response)
    } catch (e) {
      const response: WorkerResponse = {
        type: 'error',
        id: msg.id,
        error: e instanceof Error ? e.message : String(e),
      }
      self.postMessage(response)
    }
  }
}
