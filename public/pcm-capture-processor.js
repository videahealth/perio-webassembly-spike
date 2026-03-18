/**
 * AudioWorklet processor that captures raw float32 PCM.
 * Sends 128-sample chunks to the main thread via postMessage (transferred).
 * Matches videa-desktop's pcm-capture-processor.js exactly.
 */
class PCMCaptureProcessor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (input?.[0] && output?.[0]) {
      const inputChannel = input[0];
      const outputChannel = output[0];
      if (inputChannel.length > 0) {
        outputChannel.set(inputChannel);
        const copy = inputChannel.slice(0);
        this.port.postMessage({ samples: copy }, [copy.buffer]);
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture-processor', PCMCaptureProcessor);
