import { browser, read, url, wait } from "../ui/tabsBrowser";
import { LINK_CLICK_MS } from "./linkGestures";

/** U365, AL3: a browser test's way to a mounted real emulator and a pointer over its cells. */
export const load = async (kind = "agent") => {
  const seed = kind === "agent" ? "agents-10" : "selection";
  const row = kind === "agent" ? "agent-3" : "payments";
  const id = kind === "agent" ? "t-agent-3" : "t-payments";
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
  await browser("open", url(`/harness.html?rest=1&tabs=1&seed=${seed}&renderer=dom`));
  await wait(`!!window.__fake && !!document.querySelector('.rail-row[data-id="${row}"]')`);
  await read(`document.querySelector('.rail-row[data-id="${row}"]').click()`);
  await wait(`window.__terminals.has('${id}') && !!document.querySelector('.pane-screen .xterm-screen')`);
  await read(`window.__u365Emulator = window.__terminals.get('${id}'); window.__u365Emulator.ready`);

  if (kind === "shell") {
    await browser("click", ".terminal-new");
    await wait("!!document.querySelector('.bubble:not([hidden]) .xterm-screen')");
    await read("window.__u365Emulator = window.__terminals.get(document.querySelector('.bubble:not([hidden])').dataset.bubble); window.__u365Emulator.ready");
  }
};

export const output = async (text: string) => {
  await read(`new Promise(resolve => window.__u365Emulator.write(new TextEncoder().encode(${JSON.stringify(text)}), resolve))`);
  await read("new Promise(resolve => requestAnimationFrame(resolve))");
};

export const point = async (col = 2, row = 0) => read<{ x: number; y: number }>(`(() => {
  const box = (document.querySelector('.bubble:not([hidden]) .xterm-screen') ?? document.querySelector('.pane-screen .xterm-screen')).getBoundingClientRect();
  const size = window.__u365Emulator.serialize();
  return { x: Math.round(box.x + (${col} + .5) * box.width / size.cols), y: Math.round(box.y + (${row} + .5) * box.height / size.rows) };
})()`);

export const move = async (col = 2, row = 0) => {
  const p = await point(col, row);
  await browser("mouse", "move", String(p.x), String(p.y));
};

export const click = async () => { await browser("mouse", "down"); await browser("mouse", "up"); };

// An observation window bounds absence after the application's click-disambiguation timer.
export const settled = () => read(`new Promise(resolve => setTimeout(resolve, ${LINK_CLICK_MS + 50}))`);
