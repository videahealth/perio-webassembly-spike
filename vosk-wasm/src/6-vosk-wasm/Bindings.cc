#include "WasmModel.h"
#include "WasmRecognizer.h"

#include <emscripten/bind.h>
using namespace emscripten;

EMSCRIPTEN_BINDINGS(vosk_wasm)
{
  class_<WasmModel>("Model")
      .constructor<int, int>()
      .function("findWord", &WasmModel::findWord);

  class_<WasmRecognizer>("Recognizer")
      .constructor<float, WasmModel *, const std::string &>(allow_raw_pointers())
      .function("acceptWaveform", &WasmRecognizer::acceptWaveform)
      .function("finalResult", &WasmRecognizer::finalResult)
      .function("reset", &WasmRecognizer::reset)
      .function("setWords", &WasmRecognizer::setWords);
}
