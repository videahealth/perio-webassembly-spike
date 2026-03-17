import { useState, useEffect } from 'react'
import { loadPyodide, type PyodideInterface } from 'pyodide'

type PyodideResult = {
  greeting: string;
  primes: number[];
  python_version: string;
};

export default function HelloWorld() {
  const [result, setResult] = useState<PyodideResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function runPython() {
      try {
        const pyodide: PyodideInterface = await loadPyodide()

        const response = await fetch('/helloworld.py')
        const pythonCode = await response.text()
        const pyResult = await pyodide.runPythonAsync(pythonCode)

        const jsMap = pyResult.toJs() as PyodideResult;
        setResult(jsMap)
      } catch (e) {
        console.error(e);
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    }
    runPython()
  }, [])

  return (
    <div>
      <h1>Hello World</h1>
      <p style={{ color: '#888' }}>
        Running <code>helloworld.py</code> via Pyodide on the main thread
      </p>

      {loading && <p>Loading Pyodide and running Python...</p>}
      {error && <p style={{ color: 'red' }}>Error: {error}</p>}

      {result && (
        <div style={{ marginTop: '1.5rem' }}>
          <section style={{ marginBottom: '1.5rem' }}>
            <h2>Greeting</h2>
            <p style={{ fontSize: '1.2rem' }}>{result.greeting}</p>
          </section>

          <section style={{ marginBottom: '1.5rem' }}>
            <h2>Python Version</h2>
            <code>{result.python_version}</code>
          </section>

          <section>
            <h2>Primes up to 100</h2>
            <p style={{ fontFamily: 'monospace', lineHeight: '1.6' }}>
              {result.primes.join(', ')}
            </p>
          </section>
        </div>
      )}
    </div>
  )
}
