import { loadPyodide, type PyodideInterface } from 'pyodide'

export type ContinuousWorkerRequest =
  | { type: 'init' }
  | { type: 'start' }
  | { type: 'send'; payload: string }
  | { type: 'stop' }

export type ContinuousWorkerResponse =
  | { type: 'init-done' }
  | { type: 'init-error'; error: string }
  | { type: 'started' }
  | { type: 'message'; payload: string }
  | { type: 'stopped' }
  | { type: 'error'; error: string }

let pyodide: PyodideInterface | null = null

// Message queue: JS pushes incoming messages here, Python awaits them.
let messageResolve: ((value: string) => void) | null = null

/**
 * Returns a Promise that resolves with the next message from the main thread.
 * Python `await`s this, which yields control back to the JS event loop so
 * that onmessage can fire and enqueue the next value.
 */
function waitForMessage(): Promise<string> {
  return new Promise((resolve) => {
    messageResolve = resolve
  })
}

/** Called by Python to send a message back to the main thread. */
function sendMessage(payload: string) {
  const response: ContinuousWorkerResponse = { type: 'message', payload }
  self.postMessage(response)
}

self.onmessage = async (event: MessageEvent<ContinuousWorkerRequest>) => {
  const msg = event.data

  if (msg.type === 'init') {
    try {
      pyodide = await loadPyodide()
      self.postMessage({ type: 'init-done' } satisfies ContinuousWorkerResponse)
    } catch (e) {
      self.postMessage({
        type: 'init-error',
        error: e instanceof Error ? e.message : String(e),
      } satisfies ContinuousWorkerResponse)
    }
    return
  }

  if (msg.type === 'start') {
    if (!pyodide) {
      self.postMessage({ type: 'error', error: 'Pyodide not initialized' } satisfies ContinuousWorkerResponse)
      return
    }

    // Expose JS functions to Python
    pyodide.globals.set('wait_for_message', waitForMessage)
    pyodide.globals.set('send_message', sendMessage)

    self.postMessage({ type: 'started' } satisfies ContinuousWorkerResponse)

    try {
      const response = await fetch('/continuous_streaming_worker.py')
      const code = await response.text()
      await pyodide.runPythonAsync(code)
      self.postMessage({ type: 'stopped' } satisfies ContinuousWorkerResponse)
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      // "StopIteration" or similar is expected when we break the loop
      if (!error.includes('StopExecution')) {
        self.postMessage({ type: 'error', error } satisfies ContinuousWorkerResponse)
      } else {
        self.postMessage({ type: 'stopped' } satisfies ContinuousWorkerResponse)
      }
    }
    return
  }

  if (msg.type === 'send') {
    // Resolve the pending waitForMessage() promise so Python receives it
    if (messageResolve) {
      const resolve = messageResolve
      messageResolve = null
      resolve(msg.payload)
    }
    return
  }

  if (msg.type === 'stop') {
    // Send a sentinel value to break the Python loop
    if (messageResolve) {
      const resolve = messageResolve
      messageResolve = null
      resolve('__STOP__')
    }
    return
  }
}
