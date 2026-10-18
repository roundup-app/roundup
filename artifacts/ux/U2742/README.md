Terminal Bubbles obscure the background while focused and return directly to the selected Agent with ⌘B. Native delivery is still awaiting the Mac observation below; #2742 remains open.

```text
Agent ← ⌘B → same running Terminal
```

Baseline: `9e36cdb80` (the full SHA is in `revisions.json`). Head implementation: bc9306924dfaddaf3630317ffbd3836ac7987017. The specification and anchored rules are already on main through #2746. Captures use the actual App, fake Daemon and real xterm, a dedicated headless agent-browser session and a fresh temporary profile per side. They are Linux Chromium evidence, not WebKit evidence.

| Observer | Result |
| --- | --- |
| 1512×950: light, dark, increased contrast, reduced transparency | Each has fresh/sparse, full output, filled, restored, returned and saved-place captures. Dense Agent output changes behind the sparse and full-output Bubble. |
| 1280×600 | The same six states, plus `stress-minimum`: existing Rail/Shelf widths 480/500 produce a 316 px pane and a 230 px Bubble, leaving 43 px per side. |
| Fresh default | 904×848 pane → 712×656 Bubble; 672×498 pane → 480×306 Bubble. Both leave 96 px on every side. |
| Saved rectangle | x=40, y=44, width=400, height=260 survives reload, unchanged. |
| Foreground/background | Bubble text, controls and ground remain crisp and opaque. Background detail is obscured; Rail, header and Shelf stay outside the backdrop. |
| Reduced transparency | Dimming remains; `backdrop-filter` computes to `none`, and the rendered background becomes sharp. |
| Return | Agent emulator focused; no shown Bubble or open popover remains. The background is clear. |
| Densest failure | `dense-failure.png`: eight Runs, changing Agent output and the visible failed-open message. |
| Checks | All D1–D14 and D16 pass in all 64 captures. `delta.txt` records no regression (exit 0). |

| Before | After | Why |
| --- | --- | --- |
| Cascaded half-height panel; background detail readable | Centred panel with 96 px outer margins; background dimmed and blurred | Focus on one matter while keeping visible breathing room. |
| No native backdrop | One pane-bounded, pointer-transparent backdrop; crisp foreground | Preserve outside dismissal and surrounding App controls. |
| Saved 400×260 rectangle at (40,44) | Same rectangle after reload | Keep deliberate user placement. |

Images, `.checks.json` and `.observation.json` share a filename stem. Observations hold rendered geometry and backdrop state for the critic; Vitest adds no geometry assertions. In `stress-minimum`, the existing overlay Shelf also covers part of the resource/hint strip on both baseline and head; no previously passing Check regresses.

`capture.py base` expects the baseline App served on 5200; `capture.py head` expects this checkout on 5199. Start each with `pnpm --filter desktop exec vite --host 127.0.0.1 --port <port>`. Agent-browser emulates light/dark. Its CLI exposes neither contrast nor transparency preferences, so those captures apply the existing `testing/media.ts` `underSettings` CSS branches before selecting the Agent. They prove those branches render, not OS preference delivery. Return captures dispatch one DOM keydown/keyup as the harness directs; the behavioral suite separately drives real browser ⌘B presses. Mac observation remains the delivery check.

Behavioral proofs: `bubbles/u2742_browser.test.ts` covers repeated routing without lifecycle calls, tab/last-used/fallback/removal, Project isolation with colliding Terminal ids, no valid pair, Watch, unfocused Run, saved Place/emulator/screen/scroll/input continuity, held/extra modifiers/Caps Lock, Escape, rename, Help and the real Pad editor. Existing U2307a, U2236 and U2307c browser cases cover dismissal, resize/fill and bar ordering. Help, hints and the broad passthrough observer remain tied to CHORDS.

Rule 10 audit: U135 replaces the blanket filter prohibition with the single declared pseudo-element exception and retains reduced-transparency coverage. The aggregate hint-binding case becomes one parameterized case per focus place, retaining every assertion and avoiding a long shared timeout. Pull uses deliberately saved legacy rectangles; it no longer silently assumes the old default. Its no-Terminal case retains its single-open and shown-Bubble proofs, dropping position assertions now owned by this rendered observer. The reload case drops the redundant `expect(mounted).toBeDefined()`; its stored-place and Daemon-exit assertions remain. No existing behavioral test is retired.

Validation: `pnpm install --frozen-lockfile`, `just lint-web`, `just lint-rust` (including ALL PROOFS CHECK), `loop/rules.sh merge-loss` and the capture delta exit 0. The final U2742 App/browser suite passes 8/8; the repaired Pull/hint cases pass 30/30; the broad related run's five failing files replay fresh at 38/38. Existing outside-dismissal, panel-bar, resize/fill, Help, transparency and terminal-passthrough observers pass. Required GitHub check/review/critic gates judge the pushed head independently.

Failed commands/observations during development (each exit code is the command's actual failure; final validation is recorded on the Issue):

| Attempt | Exit | Repair/result |
| --- | --- | --- |
| Initial U2742 browser red test | 1 | Expected: ⌘B was unbound. Added the scoped registry action. |
| First implementation browser run | 1 | Restore attempted focus before the manual popover committed; also hit profile cleanup ENOTEMPTY. Focus now waits for Solid's same-turn commit; cleanup retries. |
| Diagnostic restore replay | 1 | Confirmed the second restore lost focus; same repair. |
| First Help/hint unit run | 1 | Added the scoped table allowlist and actual switch outcome. |
| Second Help/hint run | 1 | Distinguished tab → Bubble from Bubble → Agent; excluded the scoped chord from App-wide probes. |
| First expanded browser run | 1 | Corrected the Daemon-exit observer to its actual emitted error line. |
| Expanded eight-case browser run | 1 | Corrected escaped output and Project/Workstream fixture assumptions. |
| Subsequent eight-case browser replay | 1 | Same fixture failures; repaired with newline output, Shift+PageUp, correct Project ownership and Workstream row selection. |
| Edge-only browser replay | 1 | Same fixture defects; cleanup exceeded the default hook bound under load. Teardown has its own bounded 60 s budget. |
| Combined Bubble regression replay | 1 | Legacy/new-default fixture defects; fixed without changing behavior assertions. |
| Initial lint-web | 1 | Fixed readable-spacing violations in the added test. |
| First controlled-hint observer | 1 | Supplied successful fake Takeover handlers; split the long binding loop by focus place. |
| Pull/shortcut regression run | 1 | Pull's old-size assumptions moved to saved rectangles; controlled-hint observer repaired. |
| Pull/hint fixture replay | 1 | Exposed stale Watch hint; derive it from reactive Takeover state. All Pull tests passed. |
| Reactive hint replay | 1 | Wait for the actual focus handoff before the next input; assertions no longer race Takeover completion. |
| Broad related-file run (started before main merge and fixture repairs) | 1 | All five failing files replayed on the final checkout: 38/38 passed after fixture repairs and a warm Daemon build. Other related files passed. |
| First final head capture script | 1 | CLI key capture timed out after one mode; replay dispatches one DOM chord and verifies it was handled. No native-delivery claim. |

Required Mac observation, still pending: build bc9306924dfaddaf3630317ffbd3836ac7987017 (`pnpm install`, `just app`) and select a writable Door or already-controlled Agent with a running Terminal Bubble. Press actual ⌘B, type a distinct marker, press ⌘B and type another. Record whether focus/input go directly to the intended emulators, Rail selection stays fixed, the command continues, the foreground stays crisp and WebKit dims/blurs only the pane then removes the backdrop completely. Repeat in Watch (no control acquisition or input injection) and with Reduce transparency (no blur, dimming retained). Report any failure on #2742; Chromium is not a substitute.
