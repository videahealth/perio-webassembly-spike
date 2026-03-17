import { useContinuousWorker } from '../useContinuousWorker'

export default function ContinuousWorker() {
  const { ready, running, log, error, start, send, stop } = useContinuousWorker()

  return (
    <div>
      <h1>Continuous Worker</h1>
      <p style={{ color: '#888' }}>
        Long-lived Python process with bidirectional ping/pong messaging
      </p>

      {error && <p style={{ color: 'red' }}>Error: {error}</p>}

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
        {!running ? (
          <button
            onClick={start}
            disabled={!ready}
            style={{ padding: '8px 16px', fontSize: '1rem' }}
          >
            {!ready ? 'Loading Pyodide...' : 'Start'}
          </button>
        ) : (
          <>
            <button
              onClick={() => send('ping')}
              style={{ padding: '8px 16px', fontSize: '1rem' }}
            >
              Send Ping
            </button>
            <button
              onClick={stop}
              style={{ padding: '8px 16px', fontSize: '1rem' }}
            >
              Stop
            </button>
          </>
        )}
      </div>

      {log.length > 0 && (
        <section style={{ marginTop: '1.5rem' }}>
          <h2>Message Log</h2>
          <div style={{
            fontFamily: 'monospace',
            fontSize: '0.9rem',
            background: '#1a1a1a',
            padding: '1rem',
            borderRadius: '8px',
            maxHeight: '400px',
            overflow: 'auto',
          }}>
            {log.map((entry, i) => (
              <div key={i} style={{
                padding: '4px 0',
                color: entry.direction === 'sent' ? '#4fc3f7' : '#81c784',
              }}>
                <span style={{ color: '#888' }}>
                  {new Date(entry.timestamp).toLocaleTimeString()}{' '}
                </span>
                {entry.direction === 'sent' ? '→' : '←'} {entry.payload}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
