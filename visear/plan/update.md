# Visear — Modernization Review

A review of the app's ~1600 lines of JS/HTML/CSS looking for things a newer model or newer toolchain would flag. Items ranked by impact within each section.

## High-impact / real bugs

1. **`renderer.js:218-229` is an XSS foot-gun.** Descriptions, file paths, and similarity scores are spliced into `innerHTML` strings unescaped. Any image caption containing `"`, `<`, or `&` breaks the HTML or injects content. The model generates those captions, so today it's benign, but it's a minute of malice away. Fix: build the `<li>` with `createElement` and `.textContent`, or run values through a small `escapeHtml()`. Same pattern in `updateDirectoryList` at `renderer.js:272-279`.
2. **"Image similarity" in the ranking is circular.** `vectordb.js:247-249` picks the top text hit, uses *its* image embedding as the reference, then scores every result against that. So the 20% image-weight just amplifies the text winner — it doesn't add an independent signal. Either drop `imageWeight` or rank against the query's own image embedding (if you ever have one; CLIP would give you that).
3. **Levenshtein on captions is mostly noise (`vectordb.js:258-291`).** The vector score already encodes semantics; string-edit distance between a short query and a paragraph caption mostly returns ~0. vectra 0.14 now ships BM25 via the `isBm25` arg on `queryItems` — that's a real lexical signal, basically free, and replaces this block.
4. **Silent error-swallowing.** `jobs.js:277-278` has `catch(error) {}` inside `batchRelevance`'s polling loop — a job-check failure just disappears and the loop keeps polling a job that may have died. At minimum log it; ideally surface to the UI.
5. **`vectordb.js:73-89` nukes an entire index on any load failure.** One transient FS error → cached embeddings gone. The recovery is too aggressive; catch specific corruption errors, not everything.

## Model / stack is dated

6. **Text embedding model is a 2020 baseline.** `Xenova/all-MiniLM-L6-v2` (384d) works, but `Xenova/bge-small-en-v1.5` or `mixedbread-ai/mxbai-embed-xsmall-v1` give noticeably better retrieval quality at the same cost and are drop-in with transformers.js.
7. **`@xenova/transformers` is the old name.** The author moved to Hugging Face; the live package is `@huggingface/transformers@4.x`. Same API surface (`pipeline`, `env`). Bonus: its `onnxruntime-web` pin is post-2023, which resolves the critical `protobufjs` advisory still outstanding from the audit work.
8. **`gpt-4o-mini` for prompt enhancement is 2024 tooling.** For a 14-word rewrite, `claude-haiku-4-5` is faster, cheaper, and better at terse structured output. Swap `openai` for `@anthropic-ai/sdk`, or keep OpenAI but move to `gpt-4.1-mini`.
9. **Relevance check via RunPod is infra-heavy.** Sending each image back to a custom endpoint just to ask "is this relevant?" is a VLM call. One Claude/GPT-4o/Gemini vision call per image removes the RunPod round-trip and the queue/poll loop entirely.

## Architecture / maintenance

10. **One index per directory is fighting the vector store.** vectra supports metadata filters on `queryItems(vec, query, topK, filter)`. Using a single index with `{directory: {$in: [...]}}` filters would delete ~half of `vectordb.js` (the per-dir loops, the cache manager, the `perDirectoryLimit` heuristic) and improve ranking because scores aren't being computed on fragmented sub-corpora.
11. **`processBatch` and `batchRelevance` in `jobs.js` are 95% the same loop** — worker ramping, active-jobs map, polling, progress callback. Extract a `runBatchedJobs(payloads, buildPayload, handleResult, onProgress)` helper; cuts ~80 lines.
12. **`reloadConfigIfNeeded` in `main.js:30-36` is dead code.** The config getters already re-read from `process.env` / `store` on every call, so clearing the require cache accomplishes nothing.
13. **Pagination is "over-fetch and slice" (`vectordb.js:182, 229-247`).** You pull `limit * 3 + offset` results, sort, normalize, then slice. For larger libraries this gets slow. A real offset-aware query on the underlying index is simpler.
14. **`jimp.quality(50)` in `convert.js:6` is lossy and slow.** `sharp` is already transitively installed and is 10-20× faster. At quality 50, fine detail the VLM needs for captioning is also being thrown away.
15. **No types and no tests.** For a codebase crossing an IPC boundary 11 times (`preload.js`), JSDoc on the `electronAPI` handlers alone would catch most bugs before runtime. `npm test` is currently `exit 1`.

## Electron / security

16. **`ELECTRON_DISABLE_SECURITY_WARNINGS=true` in `main.js:2`** hides Chromium's security warnings rather than fixing them. Ship without it and see what it complains about.
17. **No Content-Security-Policy meta** in `index.html`. Add a strict CSP — with `contextIsolation:true` you can lock down `script-src 'self'` and it'll catch any XSS regression in item 1.
18. **`sandbox:false` in `BrowserWindow`** and `--no-sandbox` in the Linux build args. These exist for a reason (probably native-module issues with onnxruntime), but worth another look given Electron 41's improved sandbox native-module compat.

## Small polish

19. `prompt.js:14` — system prompt says "10-14 words" and "should not exceed 14" in the same sentence. Pick one.
20. `DROP /path` typed into the search bar irreversibly wipes an index with no confirm dialog (`renderer.js:156-176`).
21. `relevance-check` auto-toggles itself off after one search (`renderer.js:207`). Unexpected — user has to re-click it for each query.
22. `batchRelevance` silently drops non-relevant results with no UI acknowledgment. User sees "we found 20, now we see 3" and has no idea why.
23. No linter (`eslint`), no formatter (`prettier`). One config file each, minutes to set up, catches half the above over time.

## Suggested order of operations

- XSS fix (#1) + CSP header (#17) — small, independent, closes a real hole.
- Circular image similarity (#2) + Levenshtein → BM25 (#3) — both in `vectordb.js`, ship together; retrieval quality goes up, code goes down.
- `@xenova` → `@huggingface/transformers` migration (#7) — clears the critical `protobufjs` CVE still on the audit.
- Embedding model upgrade (#6) — one-line model id change once on the HF package; re-index required.
- `jobs.js` dedup + silent-catch fix (#11, #4) — mechanical refactor.
- Everything else as appetite allows.
