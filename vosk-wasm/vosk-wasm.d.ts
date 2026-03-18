export interface Model {
  findWord(word: string): number;
  delete(): void;
}

export interface Recognizer {
  /** Feed audio data. Returns JSON string with partial or final result. */
  acceptWaveform(audioData: Float32Array): string;
  /** Force-finalize and return the final result JSON string. */
  finalResult(): string;
  /** Reset the recognizer state for reuse. */
  reset(): void;
  /** Enable/disable word-level timestamps in results. */
  setWords(words: boolean): void;
  /** Free WASM resources. */
  delete(): void;
}

export interface VoskWasm {
  /**
   * Load a Vosk model from a tar ArrayBuffer.
   * The caller is responsible for fetching and decompressing the .tar.gz model file.
   * Pass the raw tar bytes (after gzip decompression) here.
   */
  createModel(tarBuffer: ArrayBuffer): Model;

  /**
   * Create a recognizer with a grammar constraint.
   * @param model - A loaded Model instance
   * @param sampleRate - Audio sample rate (e.g. 16000)
   * @param grammar - JSON array string of grammar words (e.g. '["hello", "world"]')
   */
  createRecognizer(model: Model, sampleRate: number, grammar: string): Recognizer;
}

/** Load the vosk-wasm module. Returns a promise that resolves when WASM is ready. */
declare function loadVoskWasm(): Promise<VoskWasm>;
export default loadVoskWasm;
