# perio-webassembly-spike

```
brew install git-lfs
git pull
npm i
npm run dev
```

## Current Task
* performance is not up to par atm
* when skipping VAD, (processing entire file as one chunk)
    * 1x STT node running en-us-0.22-lgraph takes 80 seconds for a 30s clip
    * 1x STT node running small-en-us-0.15 takes 8s for that same 30s clip
* when trying the demo here: https://msqr1-github-io.pages.dev/Vosklet/
    * running small-en-us-0.15 takes just 2s for that same 30s clip
    * I.E. this is likely a problem with using the unmaintained vosk-browser package
* further research is needed
* trying to integrate Vosklet failed - it does not work that cleanly
* however I was able to get a hacky test done, and did reproduce the 8s -> 2s speedup in this webapp

* next up: try to get our own local packaging of Vosk setup and see if we can get the performance gains without the Vosklet issues.

