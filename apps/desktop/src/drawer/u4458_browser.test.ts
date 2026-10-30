import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
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

    // The right side stays reachable beside the filled item while the covered centre cannot take focus.
    expect(await evaluate(`(() => {
      const reach = selector => { document.activeElement?.blur(); document.querySelector(selector)?.focus(); return !!document.activeElement?.closest(selector.split(" ")[0]); };
      return [reach('.shelf button, .shelf [tabindex]'), reach('.centre button, .centre [tabindex], .centre input')];
    })()`)).toEqual([true, false]);

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
  await lane.browser("focus", "[data-todo-root]");
  for (const key of ["Tab", "Shift+Tab"]) {
    await lane.evaluate("window.__cycle = { start: document.activeElement, nodes: [], regions: [] }");
    let complete = false;
    for (let step = 0; step < 160; step++) {
      await lane.browser("press", key);
      const state = await lane.evaluate<{ complete: boolean; centre: boolean; regions: string[] }>(`(() => {
        const el = document.activeElement;
        const cycle = window.__cycle;
        cycle.nodes.push(el);
        for (const region of ['rail', 'drawer', 'shelf']) if (el.closest('.' + region) && !cycle.regions.includes(region)) cycle.regions.push(region);
        return { complete: el === cycle.start, centre: !!el.closest('.centre'), regions: cycle.regions };
      })()`);
      if (covered) expect(state.centre, `${key} reached a covered control`).toBe(false);
      if (state.complete) {
        if (covered) expect(state.regions).toEqual(expect.arrayContaining(shelf ? ["rail", "drawer", "shelf"] : ["rail", "drawer"]));
        complete = true;
        break;
      }
    }
    expect(complete, `${key} did not complete a focus cycle`).toBe(true);
  }
};

it.each(["pad", "todo"])("u4911a_covered_centre_controls_leave_and_rejoin_tab_order_%s", { retry: 0, timeout: 240_000 }, async kind => {
  const lane = await openLane(1512, "dark", `u4911a-${kind}`);
  try {
    await lane.until("!!document.querySelector('.ask-input')");
    await lane.browser("fill", ".ask-input", "  Original unsent work 雪\nkeep this exact draft  ");
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
    await lane.until("!!document.querySelector('.storage-failure button')");
    await lane.evaluate("window.__covered = { centre: document.querySelector('.centre'), button: document.querySelector('.storage-failure button'), writes: window.__writes }");
    await lane.evaluate(`(() => { const tab = document.querySelector('#shelf-tab-${kind === "pad" ? "pads" : "todos"}'); if (tab.getAttribute("aria-expanded") !== "true") tab.click(); })()`);
    if (kind === "todo") await lane.evaluate("document.querySelector('.shelf [data-shelf-group=unassigned][data-state=closed] [data-part=branch-control]')?.click()");
    const row = kind === "pad" ? ".shelf .pad-name" : ".shelf .todo-row-button";
    await lane.browser("wait", row);
    await lane.browser("focus", row);
    await lane.browser("press", "Enter");
    await lane.until("!!document.querySelector('.drawer[data-fill=true]')");
    await cycle(lane, true, true);
    await lane.browser("click", '.drawer button[aria-label=Restore]');
    await lane.until("!!document.querySelector('.drawer[data-maximised=false]')");
    await cycle(lane, false, true);
    expect(await lane.evaluate("window.__cycle.nodes.includes(window.__covered.button)")).toBe(true);
    await lane.browser("click", '.drawer button[aria-label=Maximise]');
    await lane.until("!!document.querySelector('.drawer[data-fill=true]')");
    await lane.browser("click", '.drawer button.close');
    await lane.until("!!document.querySelector('.drawer[data-open=false]')");
    expect(await lane.evaluate(`({ same: document.querySelector('.centre') === window.__covered.centre && document.querySelector('.storage-failure button') === window.__covered.button,
      draft: document.querySelector('.ask-input').value, writes: window.__writes === window.__covered.writes, copies: window.__fake.app.clipboardWrites.length,
      submits: window.__fake.app.calls.filter(c => c.method === 'ask.send').length })`)).toEqual({ same:true, draft:"  Original unsent work 雪\nkeep this exact draft  ", writes:true, copies:0, submits:0 });
    await lane.evaluate("window.__restoreStorage()");
    await lane.browser("focus", ".storage-failure button");
    await lane.browser("press", "Enter");
    await lane.until("!document.querySelector('.storage-failure')");
    expect(await lane.evaluate("(async () => (await import('/src/settings/preferences.ts')).appSettings().fontFamily)()")).toBe("Original font 雪");
  } finally { await lane.close(); }
});
