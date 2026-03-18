import { useRef, useState, useEffect, useCallback } from 'react'
import { loadPyodide, type PyodideInterface } from 'pyodide'
import { useSttPipeline } from '../SttWorkerPipelineContext'
import type { ChunkEntry, WorkerNodeStatus, PendingChunk } from '../useSttWorkerPipeline'

type DisplayEntry = ChunkEntry & {
  commands: unknown[] | null
  chunkUrl: string | null
}

type ProcessMode = 'immediate' | 'simulated'

function float32ToWavBlob(samples: Float32Array, sampleRate = 16000): Blob {
  const numSamples = samples.length
  const buf = new ArrayBuffer(44 + numSamples * 2)
  const v = new DataView(buf)
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); v.setUint32(4, 36 + numSamples * 2, true); w(8, 'WAVE')
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true)
  v.setUint16(22, 1, true); v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  w(36, 'data'); v.setUint32(40, numSamples * 2, true)
  let off = 44
  for (let i = 0; i < numSamples; i++) {
    v.setInt16(off, Math.max(-1, Math.min(1, samples[i])) * 0x7FFF, true)
    off += 2
  }
  return new Blob([buf], { type: 'audio/wav' })
}

const VOSK_MODELS = [
  { label: 'en-us-0.22-lgraph (large)', url: '/vosk/en-us-0.22-lgraph.tar.gz' },
  { label: 'small-en-us-0.15 (small)', url: '/vosk/small-en-us-0.15.tar.gz' },
]

const POOL_SIZES = [1, 2, 3, 4, 6, 8]

const btnBase = { padding: '8px 16px', fontSize: '1rem', border: 'none', borderRadius: '4px', cursor: 'pointer' } as const
const btnPrimary = { ...btnBase, background: '#4caf50', color: '#fff' } as const
const btnSecondary = { ...btnBase, background: '#555', color: '#fff' } as const

function fmtTimeRange(startTime: number, duration: number): string {
  const fmt = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`
  return `${fmt(startTime)}-${fmt(startTime + duration)}`
}

function fmtElapsed(enqueuedAt: number, now: number): string {
  return `${((now - enqueuedAt) / 1000).toFixed(1)}s`
}

function WorkerBox({ status }: { status: WorkerNodeStatus }) {
  const hasPending = status.inFlightChunks.some(c => !c.done)
  return (
    <div style={{
      border: '1px solid #333',
      borderRadius: '6px',
      padding: '8px 12px',
      minWidth: '120px',
      background: '#1a1a1a',
      fontSize: '0.8rem',
      fontFamily: 'monospace',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: status.ready ? (hasPending ? '#ffb74d' : '#4caf50') : '#666',
          display: 'inline-block',
          flexShrink: 0,
        }} />
        <strong style={{ color: '#ddd' }}>{status.name}</strong>
        {hasPending && <span>{'\u{1F504}'}</span>}
      </div>
      {status.inFlightChunks.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: '0 6px', fontSize: '0.75rem', alignItems: 'center' }}>
          {status.inFlightChunks.map((chunk, i) => {
            const firstPending = status.inFlightChunks.findIndex(c => !c.done)
            const isProcessing = !chunk.done && i === firstPending
            const icon = chunk.done ? '\u{2705}' : isProcessing ? '\u{1F504}' : '\u{23F3}'
            const color = chunk.done ? '#4caf50' : isProcessing ? '#ffb74d' : '#888'
            return (
              <div key={chunk.chunkId} style={{ display: 'contents', color }}>
                <span>{icon}</span>
                <span>{fmtTimeRange(chunk.startTime, chunk.duration)}</span>
              </div>
            )
          })}
        </div>
      ) : (
        <div style={{ color: '#555', fontSize: '0.75rem' }}>{status.ready ? 'idle' : 'loading...'}</div>
      )}
    </div>
  )
}

function QueueBox({ jobs }: { jobs: PendingChunk[] }) {
  return (
    <div style={{
      border: '1px solid #333',
      borderRadius: '6px',
      padding: '8px 12px',
      minWidth: '120px',
      background: '#1a1a1a',
      fontSize: '0.8rem',
      fontFamily: 'monospace',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
        <strong style={{ color: '#ddd' }}>Queue</strong>
        {jobs.length > 0 && <span style={{ color: '#888' }}>({jobs.length})</span>}
      </div>
      {jobs.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: '0 6px', fontSize: '0.75rem', alignItems: 'center' }}>
          {jobs.map(job => (
            <div key={job.chunkId} style={{ display: 'contents', color: '#888' }}>
              <span>{'\u23F3'}</span>
              <span>{fmtTimeRange(job.startTime, job.duration)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ color: '#555', fontSize: '0.75rem' }}>empty</div>
      )}
    </div>
  )
}

export default function SttWorker() {
  const {
    ready,
    initializing,
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
  } = useSttPipeline()

  const [selectedModel, setSelectedModel] = useState(VOSK_MODELS[1].url)
  const [poolSize, setPoolSize] = useState(2)
  const [displayEntries, setDisplayEntries] = useState<DisplayEntry[]>([])
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [fileSamples, setFileSamples] = useState<Float32Array | null>(null)
  const [processMode, setProcessMode] = useState<ProcessMode>('immediate')
  const [skipVad, setSkipVad] = useState(false)
  const [simulating, setSimulating] = useState(false)
  const simulatingRef = useRef(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const pyodideRef = useRef<PyodideInterface | null>(null)
  const processTranscriptAllRef = useRef<((text: string) => unknown) | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [currentTime, setCurrentTime] = useState<number>(-1)
  const [now, setNow] = useState(() => performance.now())

  // Tick timer for elapsed time display in worker boxes
  useEffect(() => {
    const hasPendingWorkers = pipelineStatus.stt.some(s => s.inFlightChunks.length > 0) || pipelineStatus.queue.length > 0
    const hasPendingStt = chunks.some(c => c.text === null && !c.silence)
    if (!hasPendingWorkers && !hasPendingStt) return
    const id = setInterval(() => setNow(performance.now()), 100)
    return () => clearInterval(id)
  }, [pipelineStatus, chunks])

  async function ensurePyodide() {
    if (pyodideRef.current) return
    const py = await loadPyodide()
    const resp = await fetch('/command_normalizer.py')
    const src = await resp.text()
    await py.runPythonAsync(src)
    processTranscriptAllRef.current = py.globals.get('process_transcript_all') as (text: string) => unknown
    pyodideRef.current = py
  }

  const normalizeText = useCallback((text: string): unknown[] => {
    const fn = processTranscriptAllRef.current
    if (!fn) return []
    const pyResult = fn(text)
    const results = (pyResult as { toJs: (opts: { dict_converter: typeof Object.fromEntries }) => Record<string, unknown>[] })
      .toJs({ dict_converter: Object.fromEntries })
    const commands: unknown[] = []
    for (const r of results) {
      if (r.is_valid) {
        commands.push(r.command)
      }
    }
    return commands
  }, [])

  // Sync display entries with chunks
  useEffect(() => {
    setDisplayEntries(prev => {
      const prevById = new Map(prev.map(e => [e.id, e]))
      return chunks.map(chunk => {
        const existing = prevById.get(chunk.id)
        if (!existing) {
          const chunkUrl = chunk.audio ? URL.createObjectURL(float32ToWavBlob(chunk.audio)) : null
          return { ...chunk, commands: null, chunkUrl }
        }
        if (existing.text === null && chunk.text !== null) {
          const commands = chunk.text ? normalizeText(chunk.text) : []
          return { ...existing, ...chunk, commands }
        }
        if (existing.commands === null && existing.text !== null && processTranscriptAllRef.current) {
          const commands = existing.text ? normalizeText(existing.text) : []
          return { ...existing, commands }
        }
        return { ...existing, ...chunk }
      })
    })
  }, [chunks, normalizeText])

  // Initialize Pyodide eagerly
  useEffect(() => {
    ensurePyodide().then(() => {
      setDisplayEntries(prev =>
        prev.map(e => {
          if (e.commands === null && e.text !== null) {
            return { ...e, commands: e.text ? normalizeText(e.text) : [] }
          }
          return e
        })
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Track audio playback time for highlighting
  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    const onTime = () => setCurrentTime(el.currentTime)
    el.addEventListener('timeupdate', onTime)
    return () => { el.removeEventListener('timeupdate', onTime) }
  })

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioUrl(URL.createObjectURL(file))
    const arrayBuffer = await file.arrayBuffer()
    const audioCtx = new AudioContext({ sampleRate: 16000 })
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
    const samples = audioBuffer.getChannelData(0)
    await audioCtx.close()
    setFileSamples(new Float32Array(samples))
    setDisplayEntries([])
  }

  async function handleProcess() {
    if (!fileSamples) return
    resetState()
    setDisplayEntries([])
    if (processMode === 'immediate') {
      await processFile(new Float32Array(fileSamples) as Float32Array<ArrayBuffer>, skipVad)
    } else {
      setSimulating(true)
      simulatingRef.current = true
      if (audioRef.current) { audioRef.current.currentTime = 0; audioRef.current.play() }
      const CHUNK_SIZE = 4096
      const chunkDurationMs = (CHUNK_SIZE / 16000) * 1000
      let offset = 0
      while (offset < fileSamples.length && simulatingRef.current) {
        const end = Math.min(offset + CHUNK_SIZE, fileSamples.length)
        feedAudio(new Float32Array(fileSamples.slice(offset, end)))
        offset = end
        if (offset < fileSamples.length) await new Promise(r => setTimeout(r, chunkDurationMs))
      }
      flushVad(fileSamples.length / 16000)
      setSimulating(false)
      simulatingRef.current = false
    }
  }

  function handleStopSimulation() {
    simulatingRef.current = false
    setSimulating(false)
    flushVad()
    audioRef.current?.pause()
  }

  function handleInit() {
    init(selectedModel, poolSize)
  }

  function seekTo(seconds: number) {
    if (audioRef.current) { audioRef.current.currentTime = seconds; audioRef.current.play() }
  }

  const chunkAudioRef = useRef<HTMLAudioElement | null>(null)
  function playChunk(url: string | null) {
    if (!url) return
    if (!chunkAudioRef.current) chunkAudioRef.current = new Audio()
    chunkAudioRef.current.src = url
    chunkAudioRef.current.play()
  }

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const filteredEntries = displayEntries.filter(e => !e.silence || e.duration >= 1)
  const lastEntry = filteredEntries[filteredEntries.length - 1]
  const trailingStartTime = lastEntry ? lastEntry.startTime + lastEntry.duration : 0
  const showTrailing = simulating && !lastEntry?.silence;
  const trailingSilence: DisplayEntry | null = showTrailing ? {
    id: -1,
    audio: new Float32Array(0) as Float32Array<ArrayBuffer>,
    startTime: trailingStartTime,
    duration: Infinity,
    vadLatencyMs: 0,
    sttEnqueuedAt: 0,
    text: '',
    sttLatencyMs: null,
    silence: true,
    commands: null,
    chunkUrl: null,
  } : null
  const renderedEntries = trailingSilence ? [...filteredEntries, trailingSilence] : filteredEntries

  const activeChunkId = simulating
    ? renderedEntries[renderedEntries.length - 1]?.id ?? -1
    : renderedEntries.find(e => currentTime >= e.startTime && currentTime < e.startTime + e.duration)?.id ?? -1
  const canProcess = ready && fileSamples && !processing && !simulating && !listening
  const isBusy = processing || simulating || listening

  return (
    <div>
      <h1>STT Worker</h1>
      <p style={{ color: '#888' }}>
        Sherpa ONNX + Silero VAD + Vosk, running entirely in WASM + Web Workers
      </p>

      {initError && <p style={{ color: 'red' }}>Init error: {initError}</p>}
      {error && <p style={{ color: 'red' }}>Error: {error}</p>}

      {/* Control Panel */}
      <div style={{
        marginTop: '1rem', background: '#1a1a1a', borderRadius: '8px', padding: '1rem',
        display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.75rem 1rem', alignItems: 'center', border: '1px solid #444'
      }}>
        {/* Workers row */}
        <span style={{ color: '#888', fontSize: '0.85rem', fontWeight: 'bold', alignSelf: 'end', marginBottom: '8px' }}>Workers</span>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '0.75rem', color: '#888', textAlign: 'left' }}>
            Model
            <select
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)}
              disabled={isBusy || initializing}
              style={{ padding: '8px', fontSize: '1rem' }}
            >
              {VOSK_MODELS.map(m => (
                <option key={m.url} value={m.url}>{m.label}</option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '0.75rem', color: '#888', textAlign: 'left' }}>
            Count
            <select
              value={poolSize}
              onChange={e => setPoolSize(Number(e.target.value))}
              disabled={isBusy || initializing}
              style={{ padding: '8px', fontSize: '1rem' }}
            >
              {POOL_SIZES.map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <button
            onClick={handleInit}
            disabled={isBusy || initializing}
            style={btnPrimary}
          >
            {initializing ? 'Loading...' : ready ? 'Reload Models' : 'Load Models'}
          </button>
        </div>

        {/* Recording row */}
        <span style={{ color: '#888', fontSize: '0.85rem', fontWeight: 'bold', alignSelf: 'end', marginBottom: '8px' }}>Recording</span>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          {!listening ? (
            <button onClick={start} disabled={!ready || processing || simulating} style={btnSecondary}>
              Start Listening
            </button>
          ) : (
            <button onClick={stop} style={btnSecondary}>Stop</button>
          )}

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!ready || listening || processing || simulating}
            style={btnSecondary}
          >
            Upload WAV
          </button>
          <input ref={fileInputRef} type="file" accept=".wav" style={{ display: 'none' }} onChange={handleFileUpload} />

          {fileSamples && <>
            <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'start', gap: '2px', fontSize: '0.75rem', color: '#888' }}>
              Mode
              <select
                value={processMode}
                onChange={e => setProcessMode(e.target.value as ProcessMode)}
                disabled={processing || simulating}
                style={{ padding: '8px', fontSize: '1rem' }}
              >
                <option value="immediate">Immediate</option>
                <option value="simulated">Simulated</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'start', gap: '2px', fontSize: '0.75rem', color: '#888' }}>
              Skip VAD
              <select
                value={skipVad ? 'true' : 'false'}
                onChange={e => setSkipVad(e.target.value === 'true')}
                disabled={processing || simulating || processMode !== 'immediate'}
                style={{ padding: '8px', fontSize: '1rem' }}
              >
                <option value="false">No</option>
                <option value="true">Yes</option>
              </select>
            </label>

            {!simulating ? (
              <button
                onClick={handleProcess}
                disabled={!canProcess}
                style={btnPrimary}
              >
                {processing ? 'Processing...' : 'Process'}
              </button>
            ) : (
              <button onClick={handleStopSimulation} style={btnSecondary}>
                Stop Simulation
              </button>
            )}
          </>}

          {listening && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
              <span style={{
                width: 10, height: 10, borderRadius: '50%',
                background: speaking ? '#4caf50' : '#666',
                display: 'inline-block', transition: 'background 0.15s',
              }} />
              {speaking ? 'Speech detected' : 'Listening...'}
            </span>
          )}
        </div>
      </div>

      {/* WAV player */}
      {audioUrl && (
        <audio ref={audioRef} controls src={audioUrl} style={{ width: '100%', marginTop: '1rem' }} />
      )}

      {/* Worker status boxes: VAD → Queue → STT */}
      {pipelineStatus.stt.length > 0 && (
        <section style={{ marginTop: '1rem', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
          <WorkerBox status={pipelineStatus.vad} />
          <span style={{ color: '#555', fontSize: '1.2rem', marginTop: '8px' }}>{'\u2192'}</span>
          <QueueBox jobs={pipelineStatus.queue} />
          <span style={{ color: '#555', fontSize: '1.2rem', marginTop: '8px' }}>{'\u2192'}</span>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {pipelineStatus.stt.map(s => (
              <WorkerBox key={s.name} status={s} />
            ))}
          </div>
        </section>
      )}

      {/* Transcription results */}
      {renderedEntries.length > 0 && (
        <section style={{ marginTop: '1.5rem', textAlign: 'left' }}>
          <h2 style={{ textAlign: 'left' }}>Transcription Results</h2>
          <div style={{
            fontFamily: 'monospace', fontSize: '0.85rem',
            background: '#1a1a1a', borderRadius: '8px',
            maxHeight: '500px', overflow: 'auto', textAlign: 'left',
            paddingTop: '1rem', paddingBottom: '1rem',
            display: 'grid', gridTemplateColumns: 'min-content min-content min-content min-content min-content max-content 1fr',
            border: '1px solid #444'
          }}>
            <div style={{ display: 'contents', fontWeight: 'bold', color: '#aaa' }} className='chunk-row'>
              <span style={{ paddingLeft: '1rem', gridColumn: '1 / span 2', textDecoration: 'underline' }}>Actions</span>
              <span style={{ textDecoration: 'underline' }}>VAD</span>
              <span style={{ textDecoration: 'underline' }}>STT</span>
              <span style={{ textDecoration: 'underline' }}>Time</span>
              <span style={{paddingLeft: '20px', textDecoration: 'underline'}}>Transcript</span>
              <span style={{ textDecoration: 'underline' }}>Commands</span>
            </div>
            {renderedEntries.map((entry) => (
              <div key={entry.id} className={`chunk-row${entry.id === activeChunkId ? ' chunk-active' : ''}`} style={{ display: 'contents' }}>
                {entry.id !== -1 ? (<>
                  <button
                    className='play-btn'
                    onClick={() => playChunk(entry.chunkUrl)}
                    style={{ paddingLeft: '1rem', paddingRight: 0, border: 'none', display: 'flex', cursor: 'pointer', width: '100%', fontSize: '0.85rem' }}
                    title="Play this VAD chunk"
                  >
                    &#9654;
                  </button>
                  {entry.chunkUrl && (
                    <button
                      style={{ paddingLeft: '0px', border: 'none', display: 'flex', cursor: 'pointer', width: '100%',  fontSize: '0.85rem' }}
                    >
                      <a
                        href={entry.chunkUrl}
                        download={`chunk-${formatTime(entry.startTime).replace(':', 'm')}s.wav`}
                        style={{ color: '#888', textDecoration: 'none', fontSize: '0.75rem', alignSelf: 'start' }}
                        title="Download WAV"
                      >
                        &#11015;
                      </a>
                    </button>
                  )}
                </>) : (<>
                  <span /><span />
                </>)}
                <span style={{ color: '#aaa', whiteSpace: 'nowrap' }}>
                  {entry.vadLatencyMs}ms
                </span>
                <span style={{ color: entry.sttLatencyMs !== null ? '#4caf50' : entry.silence ? '#666' : '#ffb74d', whiteSpace: 'nowrap' }}>
                  {entry.sttLatencyMs !== null
                    ? `${(entry.sttLatencyMs / 1000).toFixed(1)}s`
                    : entry.silence
                      ? '\u2014'
                      : fmtElapsed(entry.sttEnqueuedAt, now)}
                </span>
                <a
                  href="#"
                  onClick={(e) => { e.preventDefault(); seekTo(entry.startTime) }}
                  className="timestamp-link"
                  style={{ color: entry.text !== null || entry.silence ? '#4caf50' : '#ffb74d', whiteSpace: 'nowrap', flexShrink: 0 }}
                  title={`Jump to ${formatTime(entry.startTime)}`}
                >
                  {formatTime(entry.startTime)}{entry.duration !== Infinity ? `–${formatTime(entry.startTime + entry.duration)}` : '–...'}
                </a>
                <span style={{ color: entry.silence ? '#555' : entry.text !== null ? (entry.text === '' ? '#666' : '#ddd') : '#888', padding: '0 50px 0 20px' }}>
                  {entry.silence ? 'voice not detected' : entry.text === null ? '\u{1F504}' : entry.text === '' ? '\u2014' : entry.text}
                </span>
                {entry.commands === null ? (
                  <span style={{ color: '#888', flexShrink: 0 }}>{entry.silence ? '\u2014' : '\u{1F504}'}</span>
                ) : entry.commands.length > 0 ? (
                  <span style={{ color: '#ddd', flex: 1, flexShrink: 0 }}>
                    {entry.commands.map(c => JSON.stringify(c)).join(', ')}
                  </span>
                ) : (
                  <span style={{ color: '#666', flexShrink: 0 }}>—</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
