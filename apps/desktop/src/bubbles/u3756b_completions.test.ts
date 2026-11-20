import { expect, it } from "vitest";
import { read, wait } from "../ui/tabsBrowser";
import { capture, lateUserTerminalOpen, load, newer, richPadInitialization } from "./u3756Browser";

for (const choice of ["drawer", "ask", "rail"]) {
  it(`u3756b_older_appearance_cannot_replace_a_newer_focus_choice_${choice}`, async () => {
    await load(choice === "rail" ? "tree-40" : "empty-project");
    await newer(choice);
    await read(`window.arrive()`);
    await wait(`!!document.querySelector('.pane-screen .xterm')`);
    expect(await read(`document.activeElement === window.newerFocus && (document.activeElement.value ?? document.activeElement.textContent) === window.newerText`)).toBe(true);
    expect(await read(`window.__fake.app.calls.filter(c => c.method === 'terminal.write')`)).toEqual([]);
    await capture("U3756b", choice);
  }, 90_000);
}

for (const listFirst of [false, true]) {
  it(`u3756b_a_late_user_terminal_open_${listFirst ? "list" : "reply"}_first_keeps_the_newer_drawer`, () => lateUserTerminalOpen(listFirst, true), 90_000);
}

it("u3756b_rich_pad_initialization_yields", () => richPadInitialization(true), 90_000);

// U7671a: the Worktree Panel's changed-files read and file-tree readiness path left with the Panel. The Changes view lists files as plain rows and moves no focus when it appears (`u7671a_the_worktree_control_mounts_no_second_changes_surface` shows no file tree mounts); the tests above hold the rule for each focus-on-appearance path that remains.
