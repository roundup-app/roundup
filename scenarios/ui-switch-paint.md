# UI: a view switch paints final content in its first frame (U7155a to U7155d)

Module: `apps/desktop` (the webview: `apps/desktop/src/App.tsx`, `terminal/`, `state/connectedProject.ts`). Ids: U7155a to U7155d.

Webview only: no App command, no Daemon method, no `contracts/` file, no Token. Owner report #7155 (2026-11-15): clicking another Project tab shows an empty Terminal with only the cursor in its top-left corner for a frame or more, then the Agent's output. "All the app should be very smooth with 0 flicker." Narrows U6371a (arrival focus) only by timing: focus behaviour is unchanged.

Seen on `main`: `InProject` in `apps/desktop/src/App.tsx` is a keyed `Show`, so each Project switch disposes the Pane and creates its Terminals' emulators afresh, which then replay output. This names the suspected cause; the audit (U7155d) confirms it or finds the real one.

**U7155a a Project tab switch shows the Project's last Terminal screen at once.** Given three open Projects each with an Agent Terminal holding output, and a Project's Terminal already shown once in this window, when the user selects another Project's tab and then selects the first again, then the first frame after each switch shows that Project's selected Terminal at its final size with its last screen: no empty, default-sized or cursor-only Terminal is mounted in between, no Terminal is created for a Project already open, and no output is written into an existing Terminal a second time. Test: `u7155a_a_project_switch_creates_no_terminal_and_replays_nothing` in `apps/desktop/src/`, which counts the fake App's terminal-open calls, the emulator constructions and the writes to each emulator across the switch away and back; it starts no process or browser (policy: one cheap CI test).

**U7155b a Rail selection shows the selected Terminal's last screen at once.** Given an open Project with Agents, a Workstream and a Door whose Terminals hold output, when the user selects each in turn, then the centre shows the selected Terminal's last screen in the first frame, and no switch creates a Terminal or replays output already written. Test: `u7155b_a_rail_selection_creates_no_terminal_and_replays_nothing`, in the same test file as U7155a and counting the same calls.

**U7155c a surface opening or closing never paints an empty surface.** Given an open Project, when the user opens and closes the Pad, a Todo, the Drawer, the Switcher and Settings, then no frame shows an empty or default-sized surface where the surface or the Terminal beneath it was already drawn: the Terminal beneath stays mounted at its size, and a surface that opens shows its content in its first frame. Test: `u7155c_a_surface_open_and_close_remount_no_terminal` in the same test file, counting emulator constructions and writes per surface; a surface whose first frame cannot be asserted without a browser is named in the PR as an observer by the design critic's capture (U3725), never as a test of looks (rule 10).

**U7155d every view switch in `apps/desktop/src` is audited.** Given the source tree, when the implementation PR lands, then its body lists every switch (Project tab, Rail selection, Pad, Todo, Drawer, Switcher, Settings, and any other a keyed `Show`, `Switch` or remounted component produces), whether it flickered and what fixed it, and each switch fixed by the same remedy as U7155a or U7155b has its test in the file above. Policy: the list is the proof; no test rereads the PR body.

## Mac check

Observer on the user's Mac, after merge: an agent repeats the owner's capture (clicks between three Project tabs with live Agents) and records that no frame shows an empty centre. It reports the result on #7155; a native look-and-feel check whose Linux observer is the tests above (L46).

## Regression requirements

Policy: Project switch keeps U6371a arrival focus, per-Project selection restore (U4274a) and rename, close, overflow and attention behaviour of the tabs. Cold start and keystroke-to-render budgets (rule 7) hold; keeping Terminals mounted must keep 10 idle Agents under 150 MB extra RSS, so the PR measures `just perf` and may bound what stays mounted. Rule 9 applies to any keep-alive machinery added: it reads what Solid and the installed dependencies already offer first.
