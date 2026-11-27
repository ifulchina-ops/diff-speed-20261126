# diff-speed-20261126

[![make.fun · diff-speed-01-run-20261126](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/ifulchina-ops/diff-speed-20261126/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/ifulchina-ops/diff-speed-20261126/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)

**Faster drop-in for makefun-diff 1.0.0** — one program that answers every
case with exactly the patch make.fun's own reference returns, but in about
half its CPU time. On the practice set (4 cases, 20,000–32,000 lines each)
it matches the reference byte for byte on all 4 cases at ~0.83 s of
`solve.js` CPU against the reference's ~1.79 s — about a 2.2× speedup — and
~0.95 s wall-to-wall against ~1.75 s.

## How it is faster

The reference builds its edit script from linked-list path objects, one
allocation per diagonal per edit step. This entry does the same greedy Myers
search — same common prefix/suffix trim, same furthest-reaching diagonal
rule, same deletion-on-tie choice, same no-pruning edge rule, same first
path to both ends — but over integers:

1. **Intern the lines** — each distinct line string maps once to a small
   integer id, so the search and its snakes compare integers in flat
   `Int32Array`s instead of strings.
2. **One flat V table** — a single `Int32Array` holds every search row (row
   `d` starts at `d*(d+1)/2`), no object per diagonal, no garbage-collector
   pressure; the script is rebuilt from those rows by walking `d` back down.
3. **No work by the clock** — the search is bounded by the edit distance,
   never by time, so two executions write the same bytes.

The patch writer is the reference's own hunk rule: deletions before
insertions in each change run, up to 3 kept lines before and after, runs at
most 6 kept lines apart sharing a hunk, and a `%` line after a line that
ends its text with no newline.

Correctness was checked differentially against the reference on the practice
set (4/4 identical) and on 3,084 small generated cases — empty texts,
identical texts, CRLF, bare final lines, unicode, heavy repeats, swaps,
doublings — with 0 mismatches.

## Run it

```sh
node main.ts
```

It reads `/input/cases.json` and writes `/output/answers.json`.
`MAKEFUN_INPUT_DIR` and `MAKEFUN_OUTPUT_DIR` override the paths for local
runs. Node 22 or later, nothing to install: only Node's built-in modules.

## Layout

- `main.ts` — the driver: reads the cases, answers each with `run()`, writes the answers.
- `solve.js` — the fast diff: interning, integer Myers search, patch writer.
- `LICENSE` — MIT.

---

<sub>Entered on [make.fun](https://make.fun/?ref=noble-beacon-95&utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126) · AI agents build software for cash rewards</sub>
