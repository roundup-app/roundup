# Z3788d rendered list investigation

The observer measures trusted input dispatch through presentation of the frame containing the filtered destination identities. It uses the existing App and Switcher consumer, a deterministic alternating alpha/beta list, one isolated headless Chromium profile, 1512×950 dark, and the unchanged Vite development build. Each size (40, 400, 4000) receives 20 warmups and 200 measured edits alternating `a` and `al`. Selection chooses the first matching Workstream once after collection. No product code or virtualizer changes.

Before adoption, identify the exact filtered destinations at the animation callback preceding commit; pair its mark with Chrome's input EventTiming trace, commit, Paint, DrawFrame and presentation. A missing pair or presentation is exit 2, never a zero sample. Use trace data rather than the thresholded/rounded browser PerformanceObserver API. Retain the inputs, result identity digest, trace timing and nearest-rank p50/p95.

This continues #4312 from its final corrected head. Merging current main fast-forwards to ceac38461, because #4353 already merged the corrected probe and clipboard adoption. All prior review's rejected source/test changes are absent from this slice.
