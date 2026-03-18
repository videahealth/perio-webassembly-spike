#pragma once
#include "WasmModel.h"
#include <string>

struct WasmRecognizer {
  VoskRecognizer *rec;

  WasmRecognizer(float sampleRate, WasmModel *model, const std::string &grammar);
  ~WasmRecognizer();
  std::string acceptWaveform(int start, int len);
  std::string finalResult();
  void reset();
  void setWords(bool words);
};
