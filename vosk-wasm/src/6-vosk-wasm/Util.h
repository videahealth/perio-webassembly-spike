#pragma once
#include <filesystem>
#include <fstream>
#include <cstring>

namespace fs = std::filesystem;

enum UntarStatus {
  Successful,
  IncorrectFormat,
  IncorrectFiletype,
  FailedOpen,
  FailedWrite,
  FailedClose
};

int untar(unsigned char *tar, int tarSize, const char *storepath);
