# perio-webassembly-spike

```
brew install git-lfs
git pull
npm i
npm run dev
```

## Building vosk-wasm
Building from scratch takes a while (~5-10mins) but has a Docker layer caching strategy. 
You also never need to run this unless you change anything in the `vosk-wasm/` dir, 
because the build artifacts are committed to the repo at:
* `public/vosk-wasm.js`
* `public/src/vosk-wasm.wasm` (inclusion of `src` path here to be fixed in the future, not simple fix)

```sh
bash vosk-wasm/make.sh
```

## Performance fixes ✅
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

## Transcript fixes ⌛️
* done: vosk-wasm local build is working, and it is waaaay faster. still seeing some weird behavior though:
    * transcript quality still not matching videa-desktop for same audio sample (see `test_wav_client` output to compare)
    * possible 16kHz mismatch somewhere? or VAD mismatch causing issues? something is off

* compare this difference -- chunk 0m17s gives "watch your three" from videa-desktop raw transcript and "fourteen three" for this spike repo
    * this sample is small enough to be a single VAD flush
    * im confused as well b/c `watch` and `your` aren't in the grammar. is the test file ignoring Grammar?

* chunk 0m18s gives "three two three three two or three" from videa-desktop raw and "three tooth three three to three" for this spike repo
    * this sample is small enough to be a single VAD flush

* need to create some kind of unified testing file for side by side differences 
* ideally we can test each layer independently (not separate tests, just separate snapshot outputs per-test) so it's easy to see where degradations occur (VAD changes, Transcript changes, Normalizer changes) since each thing has a big downstream impact
* TODO: test existing python layer 
* TODO: make it possible to test this local spike repo via workers in node instead of the browser (should be easy, I think? Node supports WASM)

