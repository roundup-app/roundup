# U349 rendered observer

Headless agent-browser (own session, fresh profile) on `just harness agents-10`, `agent-4` selected, light. `⌘V` is sent to the Terminal with `navigator.clipboard.readText` rejecting a 300-character message (`word ` x 60). `<w>.json` holds the boxes (left, top, right, bottom) and `<w>.png` the screen.

- 1280x800: the slot is 61.5px (three lines), its content fits (scrollHeight 62, clientHeight 62), the notice box is inside the pane (bottom 800 = the pane's bottom) and its last word is visible.
- 700x800: the slot is capped at 78px (four lines of `normal` height); the 107px of text scrolls inside it (`overflow-y: auto`), so the slot is inside the pane (top 722, bottom 800) and the last word is reached by scrolling, as U349 says "with a scroll past that". The notice's own box (to 828.5) is clipped by the slot, not drawn past the pane.

An `error` Agent (`agent-1`) has an exited Terminal and U101's paste returns early there, so it shows no notice. Chromium, not WKWebView: no native rendering claim follows.
