import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { captureDir } from "../testing/captures";
import { openLane } from "../todos/laneBrowser";
import type { LaneBrowser } from "../todos/laneBrowser";

// Solid 2 reads lag writes until the microtask flush: two clicks in one task would each compute the Tree's next fold set from the same stale set, so the second undoes the first.
const clickEach = (selector: string) => `(async () => { for (const el of document.querySelectorAll('${selector}')) { el.click(); await Promise.resolve(); } })()`;

const cycle = async (lane: LaneBrowser, covered: boolean, shelf: boolean) => {
  const run = async (...commands: string[]) => {
    const replies: { success: boolean; error?: string }[] = JSON.parse(await lane.browser("--json", "batch", "--bail", ...commands));
    const failed = replies.find(reply => !reply.success);

    if (failed) throw new Error(failed.error);
  };

  const quote = (expression: string) => "eval '" + expression.replaceAll("'", "'\\''") + "'";

  // CI5527b: one CLI connection for the two folds, so the first key's focus and start reading follow without a spawn each.
  await run(
    quote(clickEach(".rail .section-head[aria-expanded=true]")),
    quote(clickEach(".shelf .shelf-group-control[aria-expanded=true]")),
    quote("window.__cycle = { nodes: [], regions: [], ends: [] }")
  );

  // Milkdown owns Tab inside its editor. Opposite sweeps meet there without editing the Pad.
  for (const key of covered ? ["Tab", "Shift+Tab"] : ["Tab"]) {
    await run(`focus '${covered ? ".rail .section-head" : ".rail-actions button:last-child"}'`, quote("window.__cycle.start = document.activeElement"));
    let complete = false;

    for (let step = 0; step < 160; step++) {
      // CI5527e: 131832 ms on the rejected head. Keep each real key and its
      // observation sequential while avoiding a second CLI connection per step.
      const expression = `(() => {
        const el = document.activeElement;
        const cycle = window.__cycle;
        cycle.nodes.push(el);
        for (const region of ['rail', 'drawer', 'shelf']) if (el.closest('.' + region) && !cycle.regions.includes(region)) cycle.regions.push(region);
        const complete = ${covered ? "el === cycle.start || el.matches('.drawer [contenteditable=true]')" : "el === window.__covered.button"};
        if (complete) cycle.ends.push(el);
        return { complete, centre: !!el.closest('.centre') && !el.closest('.resource-agent') };
      })()`;

      const replies: { success: boolean; error?: string; result: { result: { complete: boolean; centre: boolean } } }[] = JSON.parse(await lane.browser(
        "--json", "batch", "--bail", `press ${key}`, quote(expression)
      ));

      const failed = replies.find(reply => !reply.success);

      if (failed) throw new Error(failed.error);

      const state = replies.at(-1)!.result.result;

      if (covered) expect(state.centre, `${key} reached a covered control`).toBe(false);

      if (state.complete) { complete = true; break; }
    }

    expect(complete, `${key} did not complete a focus sweep`).toBe(true);
  }

  if (covered) {
    expect(await lane.evaluate("window.__cycle.ends[0] === window.__cycle.ends[1]")).toBe(true);

    if (await lane.evaluate("!document.querySelector('.settings-view')")) {
      expect(await lane.evaluate("window.__cycle.nodes.includes(document.querySelector('.terminal-new'))")).toBe(true);
      expect(await lane.evaluate("[...document.querySelectorAll('.hint-line button:not(:disabled)')].every(button => window.__cycle.nodes.includes(button))")).toBe(true);
    }
  }

  if (covered) expect(await lane.evaluate("window.__cycle.regions")).toEqual(expect.arrayContaining(shelf ? ["rail", "drawer", "shelf"] : ["rail", "drawer"]));
};

// CI5527b: four cases at three slots ran in two waves (50 s, then 39 s); four slots run them in one.
vi.setConfig({ maxConcurrency: 4 });

// One case per background state, alternating the item kind: the exclusion is the same Drawer-fill state for Todo and Pad, and each case costs ~50 s of per-key browser round trips.
const cases = [
  {kind: "pad", background: "save"},
  {kind: "pad", background: "project-failure"},
  {kind: "todo", background: "project-settings"},
  {kind: "pad", background: "app-settings"},
] as const;

it.concurrent.each(cases)(
  "u4911a_covered_centre_controls_leave_and_rejoin_tab_order_$kind / $background", { retry: 0, timeout: 180_000 }, async ({kind, background}) => {
  const lane = await openLane(1512, "dark", `u4911a-${kind}-${background}`, false, captureDir("U4911a") ? "tree-40" : "selection");
  const phase = process.env.ROUNDUP_CAPTURE_PHASE ?? "head";
  const directory = captureDir("U4911a");
  const recording = directory && background === "save";

  if (directory) {
    mkdirSync(join(directory, phase), {recursive:true});

    if (recording) await lane.browser("record", "start", join(directory, phase, `${kind}-${background}.webm`));
    await lane.browser("set", "media", "dark");
  }

  const shot = async (step: string) => {
    if (!directory) return;
    const name = join(directory, phase, `${kind}-${background}-${step}`);
    await lane.browser("screenshot", name + ".png");
    writeFileSync(name + ".checks.json", JSON.stringify(await lane.evaluate("window.__checks()")));
  };

  try {
    await lane.until("!!document.querySelector('.rail-scroll')");
    await lane.openAsk();
    await lane.browser("fill", ".ask-input", "  Original unsent work 雪\nkeep this exact draft  ");
    // U6244c: the Ask is a modal layer that makes the Drawer and Shelf inert, so the draft waits behind Escape.
    await lane.browser("press", "Escape");
    await lane.until("!document.querySelector('.ask-input')");
    let target = ".app-toast .message-actions > button:not([data-dismiss-failure])";

    if (background === "save") {
      await lane.evaluate(`(async () => {
        const original = Storage.prototype.setItem;
        window.__writes = 0;
        window.__restoreStorage = () => { Storage.prototype.setItem = original; };
        Storage.prototype.setItem = function(key, value) {
          if (key === 'roundup:app-settings') {
            // U7489a: a tooltip's show count is saved too; only a write that changes anything else is the user's save.
            const shows = text => JSON.stringify(JSON.parse(text ?? '{}').tipShows ?? {});
            if (shows(value) === shows(localStorage.getItem(key))) window.__writes++;
            throw new Error('disk is full. Free space and retry.'); }
          return original.call(this, key, value);
        };
        await (await import('/src/settings/preferences.ts')).saveAppSettings({fontFamily:'Original font 雪'});
      })()`);
    } else if (background === "project-failure") {
      await lane.evaluate("window.__fake.app.chooseProjectPath = async () => '/original-failure'");
      await lane.browser("click", ".strip-add");
      await lane.until("!!document.querySelector('.project-tab[data-path=\"/original-failure\"] [aria-selected=true]') && !!document.querySelector('.rail-actions')");
      await lane.evaluate("window.__fake.app.of('/original-failure').handlers['workstream.create'] = () => { throw new Error('original Project refused. Retry after freeing space.'); }");
      await lane.browser("click", ".rail-actions button:first-child");
      await lane.until("!!document.querySelector('.rail-create-menu [role=menuitem]')");
      await lane.browser("find", "role", "menuitem", "click", "--name", "Workstream");
      await lane.until("!!document.querySelector('.rail-command-notice button')");
      await lane.browser("click", '.project-tab[data-path="/Users/you/harness"] [role=tab]');
      target = ".app-toast [data-dismiss-failure]";
    } else {
      if (background === "app-settings") await lane.evaluate("window.dispatchEvent(new Event('open-app-settings'))");
      else await lane.evaluate("window.dispatchEvent(new CustomEvent('open-project-page', {detail:{path:'/Users/you/harness',command:'project-settings'}}))");
      target = background === "app-settings" ? ".settings-view .settings-back" : ".settings-view .settings-head button";
    }

    await lane.until(`!!document.querySelector(${JSON.stringify(target)})`);
    await lane.evaluate(`(() => {
      window.__covered = { centre: document.querySelector('.centre'), button: document.querySelector(${JSON.stringify(target)}), writes: window.__writes, actions:0 };
      window.__covered.text = window.__covered.button.parentElement.textContent;
      window.__covered.button.addEventListener('click', () => window.__covered.actions++);
    })()`);

    for (const shelf of [true, false]) {
      await lane.evaluate(`(() => { const tab = document.querySelector('#shelf-tab-${kind === "pad" ? "pads" : "todos"}'); if (tab.getAttribute('aria-expanded') !== 'true') tab.click(); })()`);
      await lane.evaluate(clickEach(".shelf .shelf-group-control[aria-expanded=false]"));
      const row = kind === "pad" ? ".shelf .pad-name" : ".shelf .todo-row-button";
      await lane.browser("wait", row);
      await shot(`${shelf}-before`);
      await lane.browser("focus", row);
      await lane.browser("press", "Enter");
      await lane.until("!!document.querySelector('.drawer[data-open=true]')");
      await lane.until(kind === "pad" ? "!!document.querySelector('.drawer .ProseMirror')" : "!!document.querySelector('.drawer .todo-detail-title')");

      // A title on two lines pushes the editor toolbar down; the Toast stack must still leave Restore and Maximise clear.
      if (kind === "todo") await lane.evaluate("document.querySelector('.drawer .todo-detail-title p[tabindex]').textContent = 'a very long todo title that goes on and on past the width of the shelf column and wraps onto a second line of the Drawer head'");

      await lane.until("!!document.querySelector('.drawer[data-fill=true]')");

      if (!shelf) {
        await lane.browser("click", '.shelf button[aria-label="Close the Bench"]');
        await lane.until("!!document.querySelector('.window[data-shelf=closed]')");
      }

      await shot(`${shelf}-filled`);
      await cycle(lane, true, shelf);

      if (background.endsWith("settings")) expect(await lane.evaluate("window.__cycle.nodes.some(el => el.matches('.ask-input'))")).toBe(false);
      await lane.browser("click", '.drawer button.close');
      await lane.until("!!document.querySelector('.drawer[data-open=false]')");
      await shot(`${shelf}-closed`);
      await cycle(lane, false, shelf);
      await lane.openAsk();
      expect(await lane.evaluate<string>("document.querySelector('.ask-input').value")).toBe("  Original unsent work 雪\nkeep this exact draft  ");
      await lane.browser("press", "Escape");
      await lane.until("!document.querySelector('.ask-input')");
      expect(await lane.evaluate(`({ same: document.querySelector('.centre') === window.__covered.centre && document.querySelector(${JSON.stringify(target)}) === window.__covered.button,
        text: window.__covered.button.parentElement.textContent === window.__covered.text,
        writes: window.__writes === window.__covered.writes, actions:window.__covered.actions, copies:window.__fake.app.clipboardWrites.length,
        reachable:window.__cycle.nodes.includes(window.__covered.button), submits:window.__fake.app.calls.filter(c => c.method === 'ask.send').length })`)).toEqual({same:true,text:true,writes:true,actions:0,copies:0,reachable:true,submits:0});
    }

    if (background === "save") await lane.evaluate("window.__restoreStorage()");
    await lane.browser("focus", target);
    await lane.browser("press", "Enter");

    if (background === "save") {
      await lane.until("!document.querySelector('.app-toast [role=alert]')");
      expect(await lane.evaluate("(async () => (await import('/src/settings/preferences.ts')).appSettings().fontFamily)()")).toBe("Original font 雪");
    } else if (background === "project-failure") await lane.until(`!document.querySelector(${JSON.stringify(target)})`);
    else await lane.until("!document.querySelector('.settings-view')");
  } finally {
    try { if (recording) await lane.browser("record", "stop"); }
    finally { await lane.close(); }
  }
});
