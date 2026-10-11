# U196 rendered observer

`u196_real_daemon.test.ts` starts the real `rupd`, sends a 400-character Message in a headless Chromium on a fresh profile, and captures at 1280×800 and 700×800 the Thread closed (two lines and `read more`) and open (`show less`, every line within `80ch`), each with its `window.__checks()` reading.
