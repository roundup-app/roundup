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
