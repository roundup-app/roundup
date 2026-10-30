import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { captureDir } from "../testing/captures";
import { openLane } from "../todos/laneBrowser";
import type { LaneBrowser } from "../todos/laneBrowser";
import { shelfBrowser } from "../shelf/u371Browser";

const { browser, evaluate, settle, openShelf } = shelfBrowser();

const output = captureDir("U4458");

const capture = async (name: string) => {
  if (!output) return;
  mkdirSync(output, { recursive: true });
  await browser("screenshot", join(output, `${name}.png`));
  writeFileSync(join(output, `${name}.checks.json`), JSON.stringify(await evaluate("window.__checks()"), null, 2));
};

it("u4458_maximised_drawer_hides_the_centre_without_unmounting_it", { retry: 0, timeout: 90_000 }, async () => {
  await openShelf("tree-40", 288, 320, 1280, "dark");
  await browser("set", "viewport", "1280", "820");

  if (output) {
    await browser("record", "start", join(output, "pad-toggle.webm"));
    await browser("wait", ".shelf-tabs");
  }

  // Recording starts a fresh page; apply the capture scheme to that page too.
  await browser("set", "media", "dark");

  for (const kind of ["pad", "todo"]) {
    await evaluate(`(() => { const tab = document.querySelector('#shelf-tab-${kind === "pad" ? "pads" : "todos"}'); if (tab.getAttribute('aria-expanded') !== 'true') tab.click(); return true; })()`);

    if (kind === "todo") await evaluate(`(() => { const group = document.querySelector('.shelf [data-shelf-group="unassigned"] [data-part="branch-control"]'); if (group?.getAttribute('data-state') === 'closed') group.click(); return true; })()`);
    const row = kind === "pad" ? ".shelf .pad-name" : ".shelf .todo-row-button";
    await browser("wait", row);
    await browser("focus", row);
    await browser("press", "Enter");
    await browser("wait", kind === "pad" ? ".drawer .ProseMirror" : ".drawer .todo-detail-title");
    await settle();

    if (kind === "pad") {
      const before = await evaluate<string>("document.querySelector('.drawer .ProseMirror').textContent");
      await browser("focus", ".drawer .ProseMirror");
      await browser("press", "Control+End");
      await browser("press", "m");
      expect(await evaluate("document.querySelector('.drawer .ProseMirror').textContent")).toBe(before + "m");
    }

    // U4698a: the item opens filled; one click on the single expand control minimises it and one more fills again.
    await evaluate("(() => { window.__u4458 = { centre: document.querySelector('.centre'), shelf: document.querySelector('.shelf'), field: document.querySelector('.drawer input, .drawer textarea, .drawer [contenteditable=true]') }; return true; })()");
    await capture(`${kind}-maximised`);
    expect(await evaluate("document.querySelectorAll('.drawer button[aria-label=Restore], .drawer button[aria-label=Maximise]').length")).toBe(1);

    await browser("click", '.drawer button[aria-label="Restore"]');
    await settle();
    await capture(`${kind}-normal`);
    await browser("click", '.drawer button[aria-label="Maximise"]');
    await settle();

    if (output && kind === "pad") await browser("record", "stop");
    expect(await evaluate(`(() => {
      const before = window.__u4458;
      return [document.querySelector('.centre') === before.centre, document.querySelector('.shelf') === before.shelf,
        document.querySelector('.drawer').dataset.maximised, document.querySelector('.drawer').contains(before.field)];
    })()`)).toEqual([true, true, "true", true]);

    await browser("focus", '.drawer button[aria-label="Restore"]');
    await browser("press", "m");
    await settle();
    expect(await evaluate("document.querySelector('.drawer').dataset.maximised")).toBe("false");
    await browser("press", "Escape");
    await settle();
    expect(await evaluate("document.querySelector('.drawer').dataset.open")).toBe("false");
  }

  if (output) {
    await evaluate(`(() => { const tab = document.querySelector('#shelf-tab-pads'); if (tab.getAttribute('aria-expanded') !== 'true') tab.click(); return true; })()`);
    await browser("wait", ".shelf .pad-name");
    await browser("focus", ".shelf .pad-name");
    await evaluate("window.__fake.app.handlers['pad.read'] = () => { throw new Error('disk is full. Free space and try again.'); }");
    await browser("press", "Enter");
    await browser("wait", ".drawer [role=alert]");
    await settle();
    await capture("pad-failure");
  }
});


const cycle = async (lane: LaneBrowser, covered: boolean, shelf: boolean) => {
  await lane.evaluate("document.querySelectorAll('.rail [data-part=branch-control][data-depth=\"1\"][data-state=open]').forEach(el => el.click())");
  await lane.evaluate("document.querySelectorAll('.shelf [data-part=branch-control][data-state=open]').forEach(el => el.click()); window.__cycle = { nodes: [], regions: [], ends: [] }");
  // Milkdown owns Tab inside its editor. Opposite sweeps meet there without editing the Pad.
  for (const key of covered ? ["Tab", "Shift+Tab"] : ["Tab"]) {
    await lane.browser("focus", "[data-todo-root]");
    await lane.evaluate("window.__cycle.start = document.activeElement");
    let complete = false;
    for (let step = 0; step < 160; step++) {
      await lane.browser("press", key);
      const state = await lane.evaluate<{ complete: boolean; centre: boolean }>(`(() => {
        const el = document.activeElement;
        const cycle = window.__cycle;
        cycle.nodes.push(el);
        for (const region of ['rail', 'drawer', 'shelf']) if (el.closest('.' + region) && !cycle.regions.includes(region)) cycle.regions.push(region);
        const complete = el === cycle.start || el.matches('.drawer [contenteditable=true]');
        if (complete) cycle.ends.push(el);
        return { complete, centre: !!el.closest('.centre') };
      })()`);
      if (covered) expect(state.centre, `${key} reached a covered control`).toBe(false);
      if (state.complete) { complete = true; break; }
    }
    expect(complete, `${key} did not complete a focus sweep`).toBe(true);
  }
  if (covered) expect(await lane.evaluate("window.__cycle.ends[0] === window.__cycle.ends[1]")).toBe(true);
  if (covered) expect(await lane.evaluate("window.__cycle.regions")).toEqual(expect.arrayContaining(shelf ? ["rail", "drawer", "shelf"] : ["rail", "drawer"]));
};

vi.setConfig({ maxConcurrency: 2 });

const backgrounds = ["save", "retained", "project-failure", "project-settings", "app-settings"] as const;

it.concurrent.each(["pad", "todo"].flatMap(kind => backgrounds.map(background => ({kind, background}))))(
  "u4911a_covered_centre_controls_leave_and_rejoin_tab_order_$kind / $background", { retry: 0, timeout: 180_000 }, async ({kind, background}) => {
  const lane = await openLane(1512, "dark", `u4911a-${kind}-${background}`);
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
    if (background === "retained") {
      const origin = await lane.evaluate<string>("location.origin");
      await lane.evaluate(`localStorage.setItem('roundup:shelf:/original', '{"open":')`);
      await lane.browser("open", `${origin}/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40&storage-recovery=1`);
      await lane.until("!!document.querySelector('.storage-gate button:last-child')");
      await lane.browser("click", ".storage-gate button:last-child");
      await lane.until("!!document.querySelector('.storage-retained button')");
    }
    await lane.until("!!document.querySelector('[data-todo-root]')");
    await lane.browser("click", "[data-todo-root]");
    await lane.until("!!document.querySelector('.ask-input')");
    await lane.browser("fill", ".ask-input", "  Original unsent work 雪\nkeep this exact draft  ");
    let target = ".storage-failure button";
    if (background === "save") {
      await lane.evaluate(`(async () => {
        const original = Storage.prototype.setItem;
        window.__writes = 0;
        window.__restoreStorage = () => { Storage.prototype.setItem = original; };
        Storage.prototype.setItem = function(key, value) {
          if (key === 'roundup:app-settings') { window.__writes++; throw new Error('disk is full. Free space and retry.'); }
          return original.call(this, key, value);
        };
        await (await import('/src/settings/preferences.ts')).saveAppSettings({fontFamily:'Original font 雪'});
      })()`);
    } else if (background === "retained") target = ".storage-retained button";
    else if (background === "project-failure") {
      await lane.evaluate("window.__fake.app.chooseProjectPath = async () => '/original-failure'");
      await lane.browser("click", ".strip-add");
      await lane.until("!!document.querySelector('.project-tab[data-path=\"/original-failure\"] [aria-selected=true]') && !!document.querySelector('.rail-actions')");
      await lane.evaluate("window.__fake.app.of('/original-failure').handlers['workstream.create'] = () => { throw new Error('original Project refused. Retry after freeing space.'); }");
      await lane.browser("click", ".rail-actions button:first-child");
      await lane.until("!!document.querySelector('.rail-command-notice button')");
      await lane.browser("click", '.project-tab[data-path="/Users/you/harness"] [role=tab]');
      target = ".storage-center > .reserved-line:not(.todo-undo) button:last-child";
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
      await lane.evaluate("document.querySelectorAll('.shelf [data-part=branch-control][data-state=closed]').forEach(el => el.click())");
      const row = kind === "pad" ? ".shelf .pad-name" : ".shelf .todo-row-button";
      await lane.browser("wait", row);
      await shot(`${shelf}-before`);
      await lane.browser("focus", row);
      await lane.browser("press", "Enter");
      await lane.until("!!document.querySelector('.drawer[data-open=true]')");
      await lane.until(kind === "pad" ? "!!document.querySelector('.drawer .ProseMirror')" : "!!document.querySelector('.drawer .todo-detail-title')");
      // The previous iteration leaves the remembered size filled.
      if (await lane.evaluate("document.querySelector('.drawer').dataset.fill !== 'true'")) await lane.browser("click", '.drawer button[aria-label=Maximise]');
      await lane.until("!!document.querySelector('.drawer[data-fill=true]')");
      if (!shelf) {
        await lane.browser("click", '.shelf button[aria-label="Close the Bench"]');
        await lane.until("!!document.querySelector('.window[data-shelf=closed]')");
      }
      await shot(`${shelf}-filled`);
      await cycle(lane, true, shelf);
      await lane.browser("click", '.drawer button[aria-label=Restore]');
      await lane.until("!!document.querySelector('.drawer[data-maximised=false]')");
      await shot(`${shelf}-minimised`);
      await cycle(lane, false, shelf);
      expect(await lane.evaluate("window.__cycle.nodes.includes(window.__covered.button)")).toBe(true);
      if (background.endsWith("settings")) expect(await lane.evaluate("window.__cycle.nodes.some(el => el.matches('.ask-input'))")).toBe(false);
      await lane.browser("click", '.drawer button[aria-label=Maximise]');
      await lane.until("!!document.querySelector('.drawer[data-fill=true]')");
      await shot(`${shelf}-filled-again`);
      await lane.browser("click", '.drawer button.close');
      await lane.until("!!document.querySelector('.drawer[data-open=false]')");
      await shot(`${shelf}-closed`);
      await cycle(lane, false, shelf);
      expect(await lane.evaluate(`({ same: document.querySelector('.centre') === window.__covered.centre && document.querySelector(${JSON.stringify(target)}) === window.__covered.button,
        text: window.__covered.button.parentElement.textContent === window.__covered.text,
        draft: document.querySelector('.ask-input').value, writes: window.__writes === window.__covered.writes, actions:window.__covered.actions, copies:window.__fake.app.clipboardWrites.length,
        reachable:window.__cycle.nodes.includes(window.__covered.button), submits:window.__fake.app.calls.filter(c => c.method === 'ask.send').length })`)).toEqual({same:true,text:true,draft:"  Original unsent work 雪\nkeep this exact draft  ",writes:true,actions:0,copies:0,reachable:true,submits:0});
    }
    if (background === "save") await lane.evaluate("window.__restoreStorage()");
    await lane.browser("focus", target);
    await lane.browser("press", "Enter");
    if (background === "save") {
      await lane.until("!document.querySelector('.storage-failure')");
      expect(await lane.evaluate("(async () => (await import('/src/settings/preferences.ts')).appSettings().fontFamily)()")).toBe("Original font 雪");
    } else if (background === "retained") {
      await lane.until("window.__fake.app.clipboardWrites.length === 1");
      expect(await lane.evaluate("JSON.parse(window.__fake.app.clipboardWrites[0])")).toEqual({key:"roundup:shelf:/original",bytes:'{"open":'});
    } else if (background === "project-failure") await lane.until(`!document.querySelector(${JSON.stringify(target)})`);
    else await lane.until("!document.querySelector('.settings-view')");
  } finally {
    try { if (recording) await lane.browser("record", "stop"); }
    finally { await lane.close(); }
  }
});
