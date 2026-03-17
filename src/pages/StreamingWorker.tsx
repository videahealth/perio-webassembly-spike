import { useStreamingWorker } from '../useStreamingWorker'

export default function StreamingWorker() {
  const { ready, initError, run, runCode } = useStreamingWorker()

  return (
    <div>
      <h1>Streaming Worker</h1>
      <p style={{ color: '#888' }}>
        Running <code>streaming_worker.py</code> in a Web Worker with progress messages
      </p>

      {initError && <p style={{ color: 'red' }}>Init error: {initError}</p>}

      <button
        onClick={runCode}
        disabled={!ready || run.status === 'running'}
        style={{ marginTop: '1rem', padding: '8px 16px', fontSize: '1rem' }}
      >
        {!ready ? 'Loading Pyodide...' : run.status === 'running' ? 'Running...' : 'Run Python'}
      </button>

      {run.progress.length > 0 && (
        <section style={{ marginTop: '1.5rem' }}>
          <h2>Progress</h2>
          <ul style={{ fontFamily: 'monospace', listStyle: 'none', padding: 0 }}>
            {run.progress.map((msg, i) => (
              <li key={i} style={{ padding: '2px 0' }}>→ {msg}</li>
            ))}
          </ul>
        </section>
      )}

      {run.error && (
        <p style={{ color: 'red', marginTop: '1rem' }}>Error: {run.error}</p>
      )}

      {run.result && (
        <section style={{ marginTop: '1.5rem' }}>
          <h2>Result</h2>
          <pre style={{ background: '#1a1a1a', padding: '1rem', borderRadius: '8px', overflow: 'auto' }}>
            {JSON.stringify(run.result as object, replacer, 2)}
          </pre>
        </section>
      )}
    </div>
  )
}

/** JSON.stringify replacer that converts Maps to plain objects */
function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) {
    return Object.fromEntries(value)
  }
  return value
}
