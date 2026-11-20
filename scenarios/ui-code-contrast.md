# UI: code reads clearly in both themes

Module: `apps/desktop` (webview). Acceptance for Issue #7761. The surfaces are every place the App renders Markdown code, inline and fenced: the Pad editor and reading views (`pads/`, `ui/reading.styles.css`), Todo bodies and comments (`todos/`) and `.markdown` (`plain/styles.css`).

Cause: ui-sdk's `web.css` (layer `ui-sdk`) styles every `code` with `background: var(--ui-muted)`, a `light-dark()` value that follows the page's `color-scheme`. `tokens.css` sets `color-scheme: light dark` once, so it follows the operating system, never the App's Mode. With Mode `dark` on a light system the fill resolves to near-white while the code text is the App's dark-mode `--text`, so the text is pale on a pale box. No App rule gives code a fill of its own, so the Pad's `--crepe-color-inline-code` and `--crepe-color-inline-area` Tokens (the Crepe theme is deliberately not imported, `pads/editor.css`) never apply.

**U7761 code is legible in every Mode.** Policy (rendered acceptance; the design critic judges both the contrast and the fill, and no test checks a colour, rule 10): given a Pad and a Todo whose Markdown holds inline code (`cd`, `timeout`, a long command such as `! gh pr merge 7739 -R roundup-app/roundup --merge --admin`) and a fenced block, when read at 1512×950 in dark mode with the system scheme light, then:

- The inline and fenced code text has at least 4.5:1 contrast against its own fill, and the fill differs visibly from the page behind it, as Mode `light` already does.
- The same holds with the system scheme dark, and in Mode `light` on a dark system.
- The fill and ink come only from existing Tokens (`--sunken`, `--text`); no colour value is added (rule 8). The one place they are declared is shared by every surface above, never repeated per surface, and `color-scheme` follows the App's Mode so every other `light-dark()` value from ui-sdk follows it too.
- Mode `light` code stays as readable as before; inline code in a Todo body or comment reads like inline code in a Pad.

Observer (policy; capture, no colour test): `just capture U7761` takes the Pad and Todo above in dark mode with the system scheme emulated light, and the design critic reads the contrast and fill on that capture. Light stays unchanged and is read from the diff.
