/**
 * Connect to an already-running stt_websocket_server, stream a WAV file,
 * and print transcription results.
 *
 * Usage: npx tsx test_wav_client.ts <wav-file> [ws-url]
 */

import * as fs from 'fs'
import wav from 'node-wav'
import WebSocket from 'ws'

const WS_URL = process.argv[3] || 'ws://127.0.0.1:8766'

async function main() {
  const wavPath = process.argv[2]
  if (!wavPath || !fs.existsSync(wavPath)) {
    console.error(`Usage: npx tsx test_wav_client.ts <wav-file> [ws-url]`)
    process.exit(1)
  }

  const wavData = wav.decode(fs.readFileSync(wavPath))!
  const samples = wavData.channelData[0] as Float32Array
  const sampleRate = wavData.sampleRate
  console.error(`Audio: ${(samples.length / sampleRate).toFixed(1)}s, ${sampleRate} Hz, ${samples.length} samples`)
  console.error(`Connecting to ${WS_URL}...`)

  const ws = new WebSocket(WS_URL)
  const results: any[] = []

  await new Promise<void>((resolve, reject) => {
    ws.on('error', reject)

    ws.on('open', () => {
      // Send config
      ws.send(JSON.stringify({ action: 'config', sample_rate: sampleRate }))

      // Stream in 128-sample chunks to match videa-desktop's AudioWorklet output
      const chunkSamples = 128
      const totalChunks = Math.ceil(samples.length / chunkSamples)
      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSamples
        const end = Math.min(start + chunkSamples, samples.length)
        const chunk = samples.slice(start, end)
        ws.send(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength))
      }

      // Flush remaining VAD buffer
      ws.send(JSON.stringify({ action: 'flush' }))
      console.error('Audio streamed, waiting for results...')
    })

    let timeout: ReturnType<typeof setTimeout> | null = null
    const resetTimeout = () => {
      if (timeout) clearTimeout(timeout)
      timeout = setTimeout(() => {
        ws.close()
        resolve()
      }, 5000)
    }
    resetTimeout()

    ws.on('message', (data) => {
      resetTimeout()
      const msg = JSON.parse(data.toString())
      if (msg.action === 'config_set') {
        console.error('Config accepted')
      } else if (msg.event === 'vad_speech_end') {
        console.error(`  VAD chunk: ${(msg.duration_ms ?? 0).toFixed(0)}ms`)
      } else if (msg.text) {
        results.push(msg)
        const t0 = (msg.start_time / 1000).toFixed(1)
        const t1 = (msg.end_time / 1000).toFixed(1)
        console.error(`  [${t0}s-${t1}s] "${msg.text}" -> ${JSON.stringify(msg.commands || [])}`)
      }
    })
  })

  console.log(JSON.stringify(results, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
