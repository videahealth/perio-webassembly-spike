#include "WasmModel.h"
#include <emscripten/console.h>

WasmModel::WasmModel(int tarStart, int tarSize) : mdl{nullptr}
{
  unsigned char *tar = reinterpret_cast<unsigned char *>(tarStart);
  const char storepath[] = "/model";

  int res = untar(tar, tarSize, storepath);
  free(tar);

  const char *untarErr = nullptr;
  switch (res)
  {
  case IncorrectFormat:
    untarErr = "Untar: Incorrect tar format, must be USTAR";
    break;
  case IncorrectFiletype:
    untarErr = "Untar: Not a directory or regular file";
    break;
  case FailedOpen:
    untarErr = "Untar: Unable to open file for write";
    break;
  case FailedWrite:
    untarErr = "Untar: Unable to write file";
    break;
  case FailedClose:
    untarErr = "Untar: Unable to close file after write";
    break;
  }
  if (untarErr != nullptr)
  {
    emscripten_console_error(untarErr);
    return;
  }

  mdl = vosk_model_new(storepath);
  fs::remove_all(storepath);

  if (mdl == nullptr)
    emscripten_console_error("Unable to load model for recognition");
}

int WasmModel::findWord(std::string word)
{
  return vosk_model_find_word(mdl, word.c_str());
}

WasmModel::~WasmModel()
{
  if (mdl != nullptr)
    vosk_model_free(mdl);
}
