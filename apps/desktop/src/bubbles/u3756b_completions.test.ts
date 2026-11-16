import { expect, it } from "vitest";
import { browser, read, wait } from "../ui/tabsBrowser";
import { capture, fresh, lateUserTerminalOpen, load, newer, richPadInitialization } from "./u3756_support";

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

it.each([true, false])("u3756b_changed_files_read_and_library_readiness_respect_focus_permission_%s", async intervene => {
  await fresh("resources");
  // A reload restores selection; leave it before installing handlers and mounting the tested Worktree panel.
  await browser("click", '[data-id="bare-agent"] .name');
  await wait(`document.querySelector('.rail-row[data-id="bare-agent"]')?.hasAttribute('data-selected')`);
  await read(`(() => {
    window.__fake.app.handlers['agent.worktreeState'] = () => ({ahead:1,behind:0,dirty:true});
    window.__fake.app.handlers['agent.changedFiles'] = () => ({files:[{path:'src/file.ts',status:'modified',line:1}]});
    // A restored selection may have read the empty fixture; refresh after installing the files.
    window.__fake.setStatus('worktree-agent', 'idle', 'ready');
    document.querySelector('[data-id="worktree-agent"] .name').click();
  })()`);
  await wait(`!!document.querySelector('.worktree-control')`);
  await browser("click", ".worktree-control");
  await wait(`!!document.querySelector('file-tree-container')`);
  await read(`window.__fake.app.handlers['agent.changedFiles'] = () => new Promise(resolve => { window.finishFiles = () => resolve({files:[{path:'src/file.ts',status:'modified',line:1}]}); })`);
  await read(`window.__fake.setStatus("worktree-agent", "idle", "ready")`);
  await wait(`!!window.finishFiles`);

  if (intervene) await newer("rail");

  await read(`window.finishFiles()`);
  await wait(`!!document.querySelector('file-tree-container')?.shadowRoot?.querySelector('[data-item-path]')`);
  expect(await read(intervene ? `document.activeElement === window.newerFocus && (document.activeElement.value ?? document.activeElement.textContent) === window.newerText` : `document.activeElement === document.querySelector('file-tree-container')`)).toBe(true);
}, 90_000);
