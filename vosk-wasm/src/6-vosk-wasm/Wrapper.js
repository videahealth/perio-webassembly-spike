/**
 * @fileoverview Pre-JS wrapper for vosk-wasm.
 * Injected via Emscripten --pre-js. Provides a clean JS API over the raw WASM bindings.
 * @suppress {undefinedVars|checkTypes}
 */

Module = {
  'createModel': function(tarBuffer) {
    var tarBytes = new Uint8Array(tarBuffer);
    var tarStart = _malloc(tarBytes.length);
    HEAPU8.set(tarBytes, tarStart);
    // Model constructor: (int tarStart, int tarSize)
    // It calls free(tar) internally after extraction
    return new Module['Model'](tarStart, tarBytes.length);
  },

  'createRecognizer': function(model, sampleRate, grammar) {
    var rec = new Module['Recognizer'](sampleRate, model, grammar);
    var wrapper = {
      'acceptWaveform': function(audioData) {
        var start = _malloc(audioData.length * 4);
        HEAPF32.set(audioData, start / 4);
        var result = rec['acceptWaveform'](start, audioData.length);
        _free(start);
        return result;
      },
      'finalResult': function() {
        return rec['finalResult']();
      },
      'reset': function() {
        rec['reset']();
      },
      'setWords': function(words) {
        rec['setWords'](words);
      },
      'delete': function() {
        rec.delete();
      }
    };
    return wrapper;
  }
};
