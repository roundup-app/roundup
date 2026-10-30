# U4708 shared row wash

Observed in isolated headless Chromium, dark, 1512×950; journey stage: Review. Baseline: `d7cd1eaed3d4695e83a5176972aec9e7a727c8ea`. Rendered head: `baa52519133ab030a66e82afa3399993d967a036`; later commits change capture metadata and evidence only.

Ten paired states cover Rail hover/selection and Todo capture on `tree-40` and `agents-10`, plus Todo and Pad hover/selection on `tree-40`. All head Checks pass, with no passing baseline Check regressing. The baseline capture row's D12 failure passes on head; `comparison.json` records each pair. Additional dense nested/failure captures come from `just capture U4708` (all seven browser tests pass).

Rail action masks carry the same wash as their row. Plain in-window hover changes ink; selection, focus and editing retain the shared inset shape. Todo capture and existing rows end at the same edge, and the capture checkbox has balanced visible padding. The inset reads the shared `--row-inset` Token. Floating Listbox items and note fields retain hover feedback.

Images stay uncommitted in `base/` and `head/`; `head/row-polish.webm` records Rail selection and Todo capture. This observes the webview; the user reports what they meet on the Mac.
