import { expect, it } from "vitest";
import { shelfBrowser } from "./u371Browser";

const { browser, evaluate, settle, openShelf, toggle } = shelfBrowser();

it("u371_escape_closes_the_drawer_before_the_shelf", async () => {
  await openShelf("tree-40", 480, 560);
  await evaluate(`(() => { document.querySelector('.todos-tab [data-shelf-group=unassigned][data-state=closed] [data-part=branch-control]')?.click(); document.querySelector('.shelf [data-todo] .todo-row-button').focus(); return true; })()`);
  await browser("focus", ".shelf [data-todo] .todo-row-button");
  await browser("press", "Enter");
  await browser("wait", ".drawer[data-open=true]");
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

