import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { shelfBrowser } from "./u371Browser";

const { browser, evaluate, settle, openShelf, toggle } = shelfBrowser();

const STORE = "roundup:shelf:/Users/you/harness";

const calls = (method: string) => evaluate<number>(`window.__fake.app.calls.filter(call => call.method === '${method}').length`);

const saved = () => evaluate<string | null>(`localStorage.getItem('${STORE}')`);

const phase = () => evaluate<string>("document.querySelector('.window').dataset.shelf");

const pause = (ms: number) => evaluate<boolean>(`new Promise(resolve => setTimeout(() => resolve(true), ${ms}))`);

const edge = () => evaluate<number>("document.documentElement.clientWidth - 1");

const toEdge = async () => browser("mouse", "move", String(await edge()), "400");

const toCentre = () => browser("mouse", "move", "500", "400");

/** Records whether the Bench ever peeked: a peek that already slid back must still fail the test. */
const watchPeeks = () => evaluate<boolean>(`(() => {
  window.__peeked = false;
  new MutationObserver(() => { if (document.querySelector('.window').dataset.shelf === 'peek') window.__peeked = true; })
    .observe(document.querySelector('.window'), { attributes: true, attributeFilter: ['data-shelf'] });
  return true;
})()`);

const everPeeked = () => evaluate<boolean>("window.__peeked");

/** One event, dispatched at once on the element: the Bench reacts to it alone, with no pointer move around it. */
const dispatch = (selector: string, event: string) => evaluate<{ phase: string; prevented: boolean }>(`(() => {
  const target = document.querySelector('${selector}');
  const notPrevented = target.dispatchEvent(new ${event.startsWith("pointer") ? "PointerEvent" : event.startsWith("drag") ? "DragEvent" : "KeyboardEvent"}('${event}', { bubbles: true, cancelable: true, pointerType: 'mouse', key: 'x' }));
  return { phase: document.querySelector('.window').dataset.shelf, prevented: !notPrevented };
})()`);

const waitFor = (phaseName: string) => browser("wait", "--fn", `document.querySelector('.window').dataset.shelf === '${phaseName}'`);

/** A Terminal selected and focused, the Bench closed, and the counters zeroed. */
const closedBenchOverATerminal = async () => {
  await openShelf("agents-10");
  await evaluate(`document.querySelector('.rail [data-id="agent-4"] .name').click()`);
  await browser("wait", ".xterm-screen");
  await toggle();
  await browser("click", ".xterm-screen");
  await evaluate("(() => { window.__fake.app.calls.length = 0; return true; })()");
};

it("u6224_a_rest_at_the_edge_peeks_the_bench_in", async () => {
  await closedBenchOverATerminal();
  await toEdge();
  await waitFor("peek");
  await settle();
  expect(await evaluate("document.querySelector('.shelf-scrim')")).toBeNull();
  expect(await calls("terminal.resize")).toBe(0);

  const root = captureDir("U6224");

  if (!root) return;
  // The critic's frame: dark, the one viewport, the peek still covering a selected Terminal.
  const dir = join(root, "head");

  mkdirSync(dir, { recursive: true });
  await browser("set", "media", "dark");
  await browser("set", "viewport", "1512", "950");
  await settle();
  await browser("screenshot", join(dir, "peek.png"));
  writeFileSync(join(dir, "peek.checks.json"), JSON.stringify(await evaluate("window.__checks()")));
}, 90_000);

it("u6224_a_fast_pass_peeks_nothing", async () => {
  await closedBenchOverATerminal();
  await watchPeeks();
  // One eval keeps the pass inside the dwell: a process per mouse move would not.
  await evaluate(`(async () => {
    const move = x => document.elementFromPoint(x, 400).dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', clientX: x, clientY: 400 }));
    move(document.documentElement.clientWidth - 1);
    await new Promise(resolve => setTimeout(resolve, 60));
    move(500);
    return true;
  })()`);
  await pause(600);
  expect(await everPeeked()).toBe(false);
}, 90_000);

it("u6224_a_pressed_button_peeks_nothing", async () => {
  await closedBenchOverATerminal();
  await watchPeeks();
  await browser("mouse", "move", "500", "400");
  await browser("mouse", "down");
  await toEdge();
  await pause(600);
  await browser("mouse", "up");
  expect(await everPeeked()).toBe(false);
}, 90_000);

it("u6224_the_terminal_scrollbar_peeks_nothing", async () => {
  await closedBenchOverATerminal();
  await evaluate("(() => { window.__fake.writeOutput('t-agent-4', 'line\\r\\n'.repeat(300)); return true; })()");
  await settle();

  const bar = await evaluate<{ x: number; y: number } | null>(`(() => {
    const r = document.querySelector('.xterm-scrollbar.xterm-vertical')?.getBoundingClientRect();
    return r && { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);

  await watchPeeks();
  await browser("mouse", "move", String(bar!.x), String(bar!.y));
  await pause(600);
  expect(await everPeeked()).toBe(false);
}, 90_000);

it("u6224_a_peek_that_slides_back_saves_nothing_and_resizes_nothing", async () => {
  await closedBenchOverATerminal();
  const before = await saved();

  await toEdge();
  await waitFor("peek");
  await toCentre();
  await waitFor("closed");
  await browser("wait", "--fn", "document.querySelector('.shelf').hidden");
  await settle();
  expect(await calls("terminal.resize")).toBe(0);
  expect(await saved()).toBe(before);
}, 90_000);

it("u6224_leaving_without_use_slides_the_peek_back", async () => {
  await closedBenchOverATerminal();
  await toEdge();
  await waitFor("peek");
  await toCentre();
  await browser("wait", "--fn", "document.querySelector('.shelf').hidden");
  expect(await phase()).toBe("closed");
}, 90_000);

it("u6224_use_makes_the_peek_the_open_bench", async () => {
  await closedBenchOverATerminal();
  await toEdge();
  await waitFor("peek");
  await browser("click", ".shelf-area");
  await waitFor("open");
  await toCentre();
  await pause(900);
  await settle();
  expect(await phase()).toBe("open");
  expect(await calls("terminal.resize")).toBe(1);
  expect(JSON.parse((await saved())!).open).toBe(true);
}, 90_000);

it("u6224_the_open_shortcut_makes_the_peek_the_open_bench", async () => {
  await closedBenchOverATerminal();
  await toEdge();
  await waitFor("peek");
  await toggle();
  expect(await phase()).toBe("open");
  expect(await calls("terminal.resize")).toBe(1);
  expect(JSON.parse((await saved())!).open).toBe(true);
}, 90_000);

it("u6224_a_press_in_the_centre_closes_the_peek_and_reaches_the_terminal", async () => {
  await closedBenchOverATerminal();
  await evaluate("document.activeElement.blur()");
  await toEdge();
  await waitFor("peek");
  // Before any pointer move can start the grace: the press alone closes the peek, and it is not swallowed.
  expect(await dispatch(".xterm-screen", "pointerdown")).toEqual({ phase: "closed", prevented: false });
  await toCentre();
  await toEdge();
  await waitFor("peek");
  await browser("click", ".xterm-screen");
  expect(await evaluate("!!document.activeElement.closest('.xterm')")).toBe(true);
}, 90_000);

it.each(["pointerdown", "keydown", "dragenter"])("u6224_a_%s_inside_the_peek_is_use", async (event) => {
  await closedBenchOverATerminal();
  await toEdge();
  await waitFor("peek");
  expect((await dispatch(".shelf-area", event)).phase).toBe("open");
}, 90_000);

it("u6224_the_terminal_keeps_the_keyboard_during_a_peek", async () => {
  await closedBenchOverATerminal();
  await toEdge();
  await waitFor("peek");
  await browser("press", "a");
  await pause(100);
  expect(await phase()).toBe("peek");
  expect(await evaluate("window.__fake.app.calls.filter(call => call.method === 'terminal.write').map(call => JSON.stringify(call.params)).join('')")).toContain("a");
}, 90_000);

it("u6224_escape_closes_a_peek_and_reaches_no_terminal", async () => {
  await closedBenchOverATerminal();
  await toEdge();
  await waitFor("peek");
  const writes = await calls("terminal.write");

  await browser("press", "Escape");
  await waitFor("closed");
  expect(await calls("terminal.write")).toBe(writes);
}, 90_000);
