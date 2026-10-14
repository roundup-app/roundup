# Window bar observer

U449's isolated headless captures record the reserved area, centred title, below-bar Shelf and Drawer boxes at 1280×800 and 1600×800 in light and dark. `reserved-geometry.json` contains the matching U451 geometry. It observes no native traffic light, Window menu, Mission Control, movement or zoom.

`u450_` tests observe title derivation and changes against the fake App; `u451_` tests observe native drag / zoom requests and exclusion of tabs, rename fields, controls and the close-confirmation dialog. The native adapter's existing full-text setter, IPC and permission probes passed the `macos-latest` Rust job of [PR #1262](https://github.com/saadshahd/roundup/actions/runs/38461425233/job/115517278643). That job predates this shared bar and supplies no native placement or interaction observation.

[Performance report](perf.json): `just perf` exits 1 on the Linux regression comparisons already owned by #1251 / #1361. Cold start is 46.895 ms (limit 300), extra RSS is 2.621 MB (limit 150) and write-to-output p95 is 0.585 ms (limit 16). This branch changes no Daemon or performance source. These metrics do not measure time to a visible native App window.

[Performance after merging main `9bfe7fb9`](perf-merged-main.json): `just perf` exits 1 on the same Linux comparisons. Cold start is 43.135 ms, extra RSS is 2.625 MB and write-to-output p95 is 0.451 ms; the absolute limits pass. Daemon and performance source are unchanged relative to this merged main.

Native placement, Window menu / Mission Control and actual movement / zoom remain unobserved. The owner resolved the PR's Mac-check stop on 2026-10-13: Linux and Chromium tests determine readiness; the user reports what they meet on the Mac. No native result is claimed.
