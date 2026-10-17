import { expect, it } from "vitest";
import { shelfBrowser } from "./u371Browser";

const { rig, browser, evaluate, settle, openShelf, toggle } = shelfBrowser();

for (const overlay of [false,true]) it(`u371_escape_closes_the_drawer_before_the_shelf_${overlay}`, async () => {
  await openShelf("tree-40", overlay ? 480 : 288, overlay ? 560 : 320);
  await evaluate(`(() => { document.querySelector('.shelf [data-todo] .todo-row-button').click(); return true; })()`);
  await settle();
  await browser("press", "Meta+k");
  await browser("press", "s");
  await settle();
  await browser("press", "Meta+k");
  await browser("press", "s");
  await settle();
  await browser("press", "Escape");
  await settle();
  expect(await evaluate("document.querySelector('.shelf').hidden")).toBe(false);
  expect(await evaluate("document.querySelector('.drawer').dataset.open")).toBe("false");
}, 90_000);

for (const overlay of [false,true]) it(overlay ? "u371_overlay_sends_no_terminal_resize" : "u371_terminal_resizes_once_per_reserved_slide", async () => {
  await openShelf("agents-10", overlay ? 480 : 288, overlay ? 560 : 320);
  await evaluate(`(() => { document.querySelector('.rail [data-id="agent-4"] .name').click(); return true; })()`);
  await browser("wait", ".xterm-screen");
  await settle();
  await evaluate("(() => { window.__fake.app.calls.length=0; return true; })()");

  for (let n=0;n<2;n++) {
    await toggle();
    const calls = await evaluate<{method:string;params:unknown}[]>("window.__fake.app.calls");
    // U408 polls resources independently every 2 s; all other calls belong to this toggle.
    expect(calls.filter(c => c.method !== "project.resources").map(c=>c.method), JSON.stringify(calls)).toEqual(overlay ? [] : Array(n+1).fill("terminal.resize"));
  }
}, 90_000);

for (const overlay of [false, true]) it(`u371_reduced_motion_and_restore_are_instant_${overlay}`, async () => {
  await openShelf("tree-40", overlay ? 480 : 288, overlay ? 560 : 320);
  await browser("set", "media", "light", "reduced-motion");
  await settle();
  await toggle();
  expect(await evaluate("document.querySelector('.shelf').hidden")).toBe(true);
  expect(await evaluate("document.getAnimations().filter(a=>a.effect?.target?.matches?.('.shelf,.shelf-scrim,.columns')).length")).toBe(0);
  await toggle();
  await browser("set", "media", "light");
  await browser("open", `${rig.server.resolvedUrls!.local[0]}harness.html?seed=tree-40`);
  await browser("wait", ".shelf-tabs");
  await settle();
  expect(await evaluate("document.querySelector('.shelf').dataset.animated")).toBe("false");
  expect(await evaluate("document.getAnimations().filter(a=>a.effect?.target?.matches?.('.shelf,.shelf-scrim,.columns')).length")).toBe(0);
}, 90_000);
