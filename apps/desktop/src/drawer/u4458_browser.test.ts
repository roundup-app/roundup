import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { captureDir } from "../testing/captures";
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

    await capture(`${kind}-normal`);
    await evaluate("(() => { window.__u4458 = { centre: document.querySelector('.centre'), shelf: document.querySelector('.shelf'), field: document.querySelector('.drawer input, .drawer textarea, .drawer [contenteditable=true]') }; return true; })()");

    await browser("click", '.drawer button[aria-label="Maximise"]');
    await settle();
    await capture(`${kind}-maximised`);

    if (output && kind === "pad") await browser("record", "stop");
    expect(await evaluate(`(() => {
      const before = window.__u4458;
      return [document.querySelector('.centre') === before.centre, document.querySelector('.shelf') === before.shelf,
        document.querySelector('.drawer').dataset.maximised, document.querySelector('.drawer').contains(before.field)];
    })()`)).toEqual([true, true, "true", true]);

    for (let index = 0; index < 12; index++) {
      await browser("press", "Tab");
      expect(await evaluate("!!document.activeElement.closest('.centre, .shelf')")).toBe(false);
    }

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
    await evaluate("window.__fake.failNext(-32003, 'disk is full. Free space and try again.')");
    await browser("press", "Enter");
    await browser("wait", ".drawer [role=alert]");
    await settle();
    await capture("pad-failure");
  }
});
