# U4708 shared row wash

Observed in isolated headless Chromium, dark, 1512×950. Baseline: `1008613c6` on main; UI head: `04cc11b56` (later commits route captures and merge main’s test-only repair). Journey stage: Review.

Twelve paired states cover Todo hover, selection and editing; Todo capture; Pad selection and editing; Rail selection; overview hover; a routed Ask row; visible rename failure; and selected/capturing states on `agents-10`. PNGs and videos remain uncommitted under `base/` and `head/`.

All recorded Checks pass on head. No passing baseline Check regresses. Baseline D12 fails only for the Todo capture checkbox; head fits that disabled mark to its glyph column and passes D12. Compared row and title bounds are unchanged. `comparison.json` records the Check comparison.

The shared paint uses `--space-1` for its horizontal inset and `--radius-control`, keeping the existing inner padding and Token colours. This observes the webview; the user reports what they meet on the Mac.
