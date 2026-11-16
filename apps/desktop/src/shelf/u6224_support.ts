import { shelfBrowser } from "./u371Browser";

const STORE = "roundup:viewer";

/**
 * U6224: the Bench-peek browser rig and the helpers every U6224 file shares. Each test file calls it once at its top level
 * (shelfBrowser registers that file's hooks), so each file gets its own App server and browser session.
 */
export function peekBench() {
  const { browser, evaluate, settle, openShelf, toggle } = shelfBrowser();

  const calls = (method: string) => evaluate<number>(`window.__fake.app.calls.filter(call => call.method === '${method}').length`);

  const saved = () => evaluate<string | null>(`localStorage.getItem('${STORE}')`);

  const phase = () => evaluate<string>("document.querySelector('.window').dataset.shelf");

  const pause = (ms: number) => evaluate<boolean>(`new Promise(resolve => setTimeout(() => resolve(true), ${ms}))`);

  const edge = () => evaluate<number>("document.documentElement.clientWidth - 1");

  const toEdge = async () => browser("mouse", "move", String(await edge()), "400");

  const toCentre = () => browser("mouse", "move", "500", "400");

  /** One event, dispatched at once on the element: the Bench reacts to it alone, with no pointer move around it.
   * The key is ArrowDown: U7158 sends a typed character to the centre Terminal before the Bench hears it. */
  const dispatch = (selector: string, event: string) => evaluate<{ phase: string; prevented: boolean }>(`(async () => {
  const target = document.querySelector('${selector}');
  const notPrevented = target.dispatchEvent(new ${event.startsWith("pointer") ? "PointerEvent" : event.startsWith("drag") ? "DragEvent" : "KeyboardEvent"}('${event}', { bubbles: true, cancelable: true, pointerType: 'mouse', key: 'ArrowDown' }));
  // Solid 2 batches the write the event made: the page holds the new phase from the next microtask.
  await Promise.resolve();
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

  return { browser, evaluate, settle, toggle, calls, saved, phase, pause, toEdge, toCentre, dispatch, waitFor, closedBenchOverATerminal };
}
