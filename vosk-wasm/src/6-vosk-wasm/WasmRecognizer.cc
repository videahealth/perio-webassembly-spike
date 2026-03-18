#include "WasmRecognizer.h"
#include <emscripten/console.h>

WasmRecognizer::WasmRecognizer(float sampleRate, WasmModel *model, const std::string &grammar)
    : rec{vosk_recognizer_new_grm(model->mdl, sampleRate, grammar.c_str())}
{
  if (rec == nullptr)
    emscripten_console_error("Unable to initialize recognizer");
}

bool WasmRecognizer::acceptWaveform(int start, int len)
{
  float *fdata = reinterpret_cast<float *>(start);
  return vosk_recognizer_accept_waveform_f(rec, fdata, len) != 0;
}

std::string WasmRecognizer::finalResult()
{
  return vosk_recognizer_final_result(rec);
}

void WasmRecognizer::reset()
{
  vosk_recognizer_reset(rec);
}

void WasmRecognizer::setWords(bool words)
{
  vosk_recognizer_set_words(rec, words);
}

WasmRecognizer::~WasmRecognizer()
{
  if (rec != nullptr)
    vosk_recognizer_free(rec);
}
