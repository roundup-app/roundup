import { expect } from "vitest";
import { browser, origin, read } from "./u484Browser";

// U7276a–b run in the App harness, whose lists hold real rows, controls and RPC calls.
export const REORDERS = "window.__fake.app.calls.filter(c => ['rail.move', 'todo.reorder', 'todo.setBlockers', 'todo.move', 'pad.reorder', 'pad.setOwner'].includes(c.method)).length";

/** Opens the harness on `seed` and starts counting: `__dragged` turns true once any row is lifted, `__hits` counts unswallowed clicks on `target`. */
export const harness = async (seed: string, open: (() => Promise<void>) | null, target: string) => {
  const href = new URL(`harness.html?view=workstreams&items=1&tabs=1&seed=${seed}`, origin).href;
  // A case that folds a row or opens a tab stores it; the next case starts from the seed's own layout.
  await browser("open", href);
  await browser("eval", "localStorage.clear()");
  await browser("open", href);
  await browser("wait", "--fn", "!!window.__fake && !!document.querySelector('.rail-tree .rail-row')");
  await open?.();
  await browser("wait", "--fn", `!!document.querySelector(${JSON.stringify(target)})`);
  await read(`(() => {
    window.__dragged = false;
    new MutationObserver(() => { if (document.querySelector('[data-dnd-dragging]')) window.__dragged = true; }).observe(document.body, { subtree: true, childList: true, attributes: true });
    window.__hits = 0;
    // A swallowed click stops at the window's capture phase and never reaches the document.
    document.addEventListener('click', event => { if (event.target instanceof Element && event.target.closest(${JSON.stringify(target)})) window.__hits += 1; }, true);
    window.__fake.app.calls.length = 0;
    return true;
  })()`);
};

export const todos = async () => {
  await browser("eval", `document.querySelector('.rail-row[data-id="tokens"] [data-pads-control]').click()`);
  await browser("wait", "--fn", 'document.querySelectorAll(".todos-tab .todo-row-button").length > 1');
};

/** A point `inset` px into `selector`'s box from its start, or its centre when `inset` is null. */
export const pointIn = (selector: string, inset: number | null) => read<{ x: number; y: number }>(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  el.scrollIntoView({ block: 'nearest' });
  const b = el.getBoundingClientRect();
  return { x: Math.round(${inset === null ? "b.left + b.width / 2" : `b.left + ${inset}`}), y: Math.round(b.top + b.height / 2) };
})()`);

/** Whether the lifted row is the one `selector` names. */
const holds = (selector: string) => read<boolean>(`(() => {
  const lifted = document.querySelector('[data-dnd-dragging]');
  const pressed = document.querySelector(${JSON.stringify(selector)});
  return !!lifted && !!pressed && (lifted.contains(pressed) || pressed.contains(lifted));
})()`);

/** Presses at `at`, moves `by` px down in steps and waits for the lifted row; Escape and the release then cancel it. */
export const liftAndCancel = async (selector: string, at: { x: number; y: number }, by: number) => {
  await browser("mouse", "move", String(at.x), String(at.y));
  await browser("mouse", "down");

  for (const step of [0.25, 0.5, 1]) await browser("mouse", "move", String(at.x), String(Math.round(at.y + by * step)));
  await browser("wait", "--fn", "!!document.querySelector('[data-dnd-dragging]')");
  expect(await holds(selector)).toBe(true);
  await browser("press", "Escape");
  await browser("mouse", "up");
  await browser("wait", "--fn", "!document.querySelector('[data-dnd-dragging], [data-dnd-placeholder]')");
  expect(await read<number>(REORDERS)).toBe(0);
};

/** U7276b: the press moves 20 px away and back before the release, so the release lands on the control and its own click can act. */
export const expectControlPressNeverDrags = async ({ seed, open, target }: { seed: string; open: (() => Promise<void>) | null; target: string }) => {
  await harness(seed, open, target);
  const at = await pointIn(target, null);
  await browser("mouse", "move", String(at.x), String(at.y));
  await browser("mouse", "down");

  for (const dx of [5, 10, 20, 10, 0]) await browser("mouse", "move", String(at.x + dx), String(at.y));
  await browser("mouse", "up");
  await browser("wait", "--fn", "window.__hits === 1");
  expect(await read<boolean>("window.__dragged")).toBe(false);
  expect(await read<number>(REORDERS)).toBe(0);
};
