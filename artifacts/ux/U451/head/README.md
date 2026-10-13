# Window bar observer

U449's isolated headless captures record the reserved area, centred title, below-bar Shelf and Drawer boxes at 1280×800 and 1600×800 in light and dark. `reserved-geometry.json` contains the matching U451 geometry. It observes no native traffic light, Window menu, Mission Control, movement or zoom.

`u450_` tests observe title derivation and changes against the fake App; `u451_` tests observe native drag / zoom requests and exclusion of tabs, rename fields, controls and the close-confirmation dialog. The native adapter's existing full-text setter, IPC and permission probes passed the `macos-latest` Rust job of [PR #1262](https://github.com/saadshahd/roundup/actions/runs/38461425233/job/115517278643). That job predates this shared bar and supplies no native placement or interaction observation.

[Performance report](perf.json): `just perf` exits 1 on the Linux regression comparisons already owned by #1251 / #1361. Cold start is 46.895 ms (limit 300), extra RSS is 2.621 MB (limit 150) and write-to-output p95 is 0.585 ms (limit 16). This branch changes no Daemon or performance source. These metrics do not measure time to a visible native App window.

The native policy observer in `scenarios/ui-window-bar.md` U451 remains unobserved. On this PR's head, use two disposable Projects, one with two Workstreams, and run `pnpm install` then `just app <project-path>` on a Mac. At a width of at least 1280 px:

1. Check that native traffic lights and tabs share one row and do not overlap. Open every Drawer and check that no box or shadow covers the row.
2. Select each Workstream and its Agent, switch Projects, rename the open Project and Workstream, and compare the displayed title with the Window menu and Mission Control after each update.
3. Drag empty bar space, double-click it to zoom, and double-click a tab name to rename without zooming.
4. Close the last Project; the bar, Window menu and Mission Control should read `roundup`.

Record pass / fail for each operation here. A pass supplies the remaining native acceptance; a failure identifies the behavior to repair before readiness and completion.
