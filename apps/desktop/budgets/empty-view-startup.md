# U3010d startup observation

Node v22.23.4, pnpm 10.14.0; clean `pnpm install`, `pnpm --filter desktop build`.
Each emitted JS file is compressed independently with `gzipSync(bytes, { level: 9 })`.
`checkStartup` follows the manifest and verifies all artifact hashes. A temporary
`{"entryGzipBytes":400000}` config exercises U3010d without changing the configured guard.

| Immutable revision | Entry gzip bytes | Full eager JS gzip bytes | Result |
| --- | ---: | ---: | --- |
| `8604b4fc8702f0ffa4b9ec7b6e1bb402bddf8745` | 267,873 | 414,342 | exit 1: at or above 400,000 |

The base has 11 eager JS files, 1,291,913 raw bytes. The configured startup guard
passes its unchanged 437,814-byte ceiling; that pass does not meet U3010d.

Candidate builds used identical settings on the base:

| Deferral | Entry gzip | Eager closure gzip |
| --- | ---: | ---: |
| Import panel | 243,899 | 412,496 |
| Import panel + App Settings controls | 230,257 | 402,246 |
| Above + Pads list | 152,142 | 388,821 |
| Import panel + Pads list | 163,355 | 399,203 |
| Pair with Solid pending/error/retry feedback | 163,592 | 399,440 |
| Selected pair, including Close during unavailable imports | 163,633 | 399,481 |

Select the two requested-only surfaces; discard the App Settings experiment.
Both production callers of Pads defer it: Shelf and draft recovery. Keeping
one static caller retains the list and its owner picker in the eager closure.
Existing readers, draft stores, commands and drawer content keep their owners.

Previously eager modules move into these lazy chunks:

| Chunk | Raw bytes | Gzip bytes | Previously eager modules |
| --- | ---: | ---: | ---: |
| Disclosure-CFXbHdkT.js | 433 | 296 | 1 |
| ImportPanel-xZT6XrsP.js | 8,698 | 2,939 | 1 |
| OwnerPicker-DmQqwbn8.js | 42,645 | 12,575 | 14 |
| Pads-_al2kpeH.js | 14,128 | 5,550 | 3 |

Motion's incremental bytes are zero; no Motion module moves into a lazy chunk.
The entry reduction is 104,240 bytes; the eager-closure reduction is 14,861 bytes,
because shared modules split into additional eager chunks. The full closure
decides the budget. The PR records the final immutable head after committing.

After merging `origin/main` (`95dff3cba`), clean production build of immutable
`66e598a244afbdc1877bc1c46500a3267e2263ae` passes both observers: `checkStartup`
with the temporary 400,000-byte ceiling exits 0 at **399,474 gzip bytes**
(19 eager JS files; 1,232,248 raw bytes); the unchanged configured guard also
exits 0. Node and pnpm versions, installation and compression settings match
the base above. The three existing startup-budget tests pass.
Entry-only: `assets/index-CKFmYgeB.js`, 528,034 raw / 163,629 gzip bytes.
The moved JS chunks on that revision are `Disclosure-D02pOFbA.js` (299),
`ImportPanel-DlK4rp1R.js` (2,939), `OwnerPicker-C2RhnXqe.js` (12,573) and
`Pads-D_2Ajwa9.js` (5,548): 21,359 gzip bytes total. Motion's incremental
bytes remain zero.
