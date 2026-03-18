#pragma once
#include "Util.h"
#include "vosk_api.h"

struct WasmModel {
  VoskModel *mdl;

  WasmModel(int tarStart, int tarSize);
  ~WasmModel();
  int findWord(std::string word);
};
