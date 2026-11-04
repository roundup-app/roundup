# UI: an image an Agent draws shows in its Terminal (U5984)

Module: `apps/desktop` (the webview). Ids: U5984, U5985. Source: the owner's report in #5984: an Agent Terminal shows `cmp.png` as a boxed file name, not the picture. Terms: Agent, Terminal, Door, Bubble, Thread, Pad (`GLOSSARY.md`). Acceptance only.

**U5984 the Terminal answers Kitty graphics and stores the image.** Claude Code 2.1.316 draws a picture inline only when the terminal answers its Kitty graphics query (`a=q`); it takes the iTerm2 path only when XTVERSION names iTerm2 3.5 or later. The App's emulator (`apps/desktop/src/terminal/emulator.ts`) answers neither today, so Claude Code draws the alt text in a box. Given an Agent Terminal on the App's emulator, then:

- *Query.* A Kitty query (`ESC _G i=31,s=1,v=1,a=q,t=d,f=24;AAAA ESC \`) followed by a primary device attributes request gets an `OK` reply for id 31 before the attributes reply. Test: `u5984_the_emulator_answers_the_kitty_query`, in `apps/desktop/src/terminal/u5984_terminal_images.test.ts`, writes both to the emulator and asserts the bytes it sends back.
- *Draw.* A chunked `f=100` PNG transfer (`a=T`, `m=1` chunks, a last `m=0` chunk, including an empty first chunk and a bare final `m=0`) leaves one stored image at the cursor's cell, scrolling with the output and counted in scrollback. The same holds for JPEG, GIF and WebP when the Kitty path carries them as `f=100`, or the surface names the format it cannot draw. Test: `u5984_a_chunked_png_is_stored_as_one_image`.
- *Reopen.* An image the Terminal showed is shown again when the Terminal reopens from its saved output, as other output is. Test: `u5984_a_reopened_terminal_redraws_its_image`.
- *Bounds.* The 16 MB decoded cache and 4 Mpx per Terminal of the existing addon hold; an image over them is dropped with the text intact, and rule 7's keystroke-to-render and idle-RSS budgets hold (`just perf`). Test: `u5984_an_oversized_image_is_dropped_and_text_survives`.
- *No spoofing.* XTVERSION names xterm.js or roundup, never iTerm2. `CLAUDE_CODE_FORCE_TERMINAL_IMAGES` is set only if the Terminal really draws Kitty images, as the clauses above prove. Test: `u5984_xtversion_never_names_iterm2`.
- *No remote image.* No remote image URL from generated text loads anywhere; `apps/desktop/src/plain/renderMarkdown.ts` keeps drawing the alt text for generated images, remote URLs included. Test: `u5984_a_remote_image_url_draws_its_alt_text`.

Integration, for the implementation's `Reuse:` section (rule 9): `@xterm/addon-image` 0.9.0 handles SIXEL and iTerm2 only. Its `0.10.0` betas add partial Kitty graphics and need `@xterm/xterm` `^6.1.0-beta`, while the App pins a patched 6.0.0 (`patches/@xterm__xterm@6.0.0.patch`). Research those betas first, then the open Kitty fixes (xtermjs/xterm.js#6212, open on 2026-11-03: chunked transfers with an empty first chunk or a bare `m=0` draw nothing, and a stale pending transfer swallows the next image; review asks for `a=q` and `a=p` to leave a pending transfer alone). Pick the library path that passes every clause above, port the patch to it, and name for each rejected candidate the missing capability. A hand-written Kitty parser is allowed only when every candidate fails.

Observer: Vitest against the App's emulator, in `just check` (a cheap test, no process). The real-`claude` observer: a real `claude` in an Agent Terminal reads a PNG and draws the picture, not its alt text, on the implementation's revision. Only the user's Mac has a logged-in real `claude`; the build run asks for that observation in the Mac-observer format and records it on the Issue, and the fake cannot satisfy it. Moves D2, D5, D6 only if a visible state changes; Tokens only.

**U5985 every surface that shows an Agent's output shows a local image the Agent makes, or names why not.** Given a PNG file the Agent makes, then the audit table in the implementation PR lists each surface, its result and the test that proves it:

- *Agent Terminal and Door Terminal.* Both show the picture a drawn image sequence names (U5984); the Door's Terminal is the same emulator. Test: `u5985_the_door_terminal_draws_an_image`.
- *Terminal Bubble.* Shows the picture as the Agent Terminal does. Test: `u5985_a_bubble_draws_an_image`.
- *Thread* (today the Door's Terminal, U467) and *Pads* (`scenarios/pads.md`). Each either shows a local image the Agent makes, or the audit names, in the PR, the clause or code that makes it text-only. A surface that should show one gets the fix and a test `u5985_<surface>_shows_a_local_image` in the same PR; remote URLs stay alt text.
- No surface loads a remote URL, and a path outside the Project and the Agent's own temporary files is never read for display. Test: `u5985_a_remote_or_foreign_path_is_not_loaded`.

Observer: Vitest in `apps/desktop/src`, in `just check`; the audit table is in the PR body.
