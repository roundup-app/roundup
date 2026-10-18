import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";
import { startRealDaemon } from "../testing/realDaemonFixture";
import type { StartedDaemon } from "../testing/realDaemonFixture";

/** U59's observer: ten Agents on the real `rupd` and a real Chromium; the selected Terminal passes D1, D6, D7 and D10. */

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

let real: StartedDaemon;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U59 needs a Chrome binary: set CHROME_PATH");

  real = await startRealDaemon({}, true);
  page = await openPage(found);
}, 300_000);

afterAll(async () => {
  await page?.close();
  await real?.stop();
});

type Checks = Record<string, { status: string; selector: string }>;

/** A cold dev server may reload the page once it has bundled its dependencies, or a loaded runner may stall it, so the page is loaded again when the rail has not come up. */
const openHarness = async () => {
  for (let attempt = 1; ; attempt += 1) {
    await page.load(`${real.base}/harness.html?daemon=1`, 1280, 800);

    try {
      await page.until(`() => Boolean(document.querySelector(".rail-actions button"))`, 20_000);

      return;
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
};

run("u59 on the real Daemon", () => {
  vi.setConfig({ testTimeout: 120_000 });

  it("u59_ten_agents_on_the_real_daemon_leave_d1_d6_d7_and_d10_clean", async () => {
    await openHarness();
    await page.call(`() => [...document.querySelectorAll("button")].find((each) => (each.getAttribute("aria-label") === "Add Workstream" || each.textContent.includes("New Workstream"))).click()`);

    for (let count = 1; count <= 10; count += 1) {
      await page.until(`() => [...document.querySelectorAll("button")].find((each) => each.getAttribute("aria-label") === "Add Agent")?.getAttribute("aria-disabled") !== "true" && Boolean([...document.querySelectorAll("button")].find((each) => each.getAttribute("aria-label") === "Add Agent"))`);
      await page.call(`() => [...document.querySelectorAll("button")].find((each) => each.getAttribute("aria-label") === "Add Agent").click()`);
      await page.until(`() => document.querySelectorAll('.rail [role="treeitem"]:not([data-button])').length >= ${count + 1}`);
    }

    await page.until(`() => Boolean(document.querySelector(".xterm-scrollable-element")) && Boolean(document.querySelector("textarea.xterm-helper-textarea"))`);

    const checks = await page.call<Checks>(`() => window.__checks()`);

    expect(["D1", "D6", "D7", "D10"].map((id) => [id, checks[id]!.status, checks[id]!.selector])).toEqual([["D1", "pass", ""], ["D6", "pass", ""], ["D7", "pass", ""], ["D10", "pass", ""]]);
  });
});

it.runIf(process.env["U2680_REAL"] === "1")("u2680a_u2680b_real_zsh_webgl_selection_observer", async () => {
  const selectionDaemon = await startRealDaemon({ SHELL: "/bin/zsh" }, true);

  const read = <T,>(expression: string) => page.call<T>(`() => (${expression})`);
  const until = (expression: string) => page.until(`() => (${expression})`);
  const point = (selector: string) => page.call<{ x: number; y: number }>(`selector => {
    const box = document.querySelector(selector).getBoundingClientRect();

    return { x: Math.round(box.left + 2), y: Math.round(box.top + box.height / 2) };
  }`, selector);

  const click = async (selector: string) => {
    const at = await point(selector);

    await page.click(at.x, at.y);
  };

  const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await page.pointer("move", from.x, from.y);
    await page.pointer("down", from.x, from.y);

    for (let step = 1; step <= 5; step++) await page.pointer("move", from.x + (to.x - from.x) * step / 5, from.y + (to.y - from.y) * step / 5);
    await page.pointer("up", to.x, to.y);
  };

  try {
    await page.load(`${selectionDaemon.base}/harness.html?daemon=1`, 1512, 950);
    await until("!!document.querySelector('.terminal-new')");
    await click(".terminal-new");
    await until("!!document.querySelector('.bubble:not([hidden]) .xterm-screen canvas')");
    await page.call("() => { window.__emu = [...window.__terminals.values()][0]; }");
    await page.call("() => document.querySelector('.bubble:not([hidden]) .xterm-helper-textarea').focus()");
    await page.call("() => document.execCommand('insertText', false, \"printf 'alpha bravo charlie delta echo foxtrot %.0s' {1..1000}\")");
    await page.press("Enter", "Enter");
    await until(`(async () => {
      const id = document.querySelector('.bubble:not([hidden])').dataset.bubble;
      const response = await fetch('/__daemon/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'terminal.snapshot', params: { id } }) });
      const reply = await response.json();
      return reply.result && atob(reply.result.data).split('alpha bravo charlie delta echo foxtrot').length > 10;
    })()`);
    const screen = ".bubble:not([hidden]) .xterm-screen";
    const at = await point(screen);
    const from = { x: at.x + 20, y: await read<number>("Math.round(document.querySelector('.bubble:not([hidden]) .xterm-screen').getBoundingClientRect().top + 8)") };

    await drag(from, { x: from.x + 100, y: from.y });
    expect(await read<string>("window.__emu.selection()")).not.toBe("");
    expect(await read<boolean>("getSelection().isCollapsed")).toBe(true);
    await click(".bubble-header");
    expect(await read<string>("window.__emu.selection()")).toBe("");
    await page.doubleClick(from.x + 20, from.y);
    expect(await read<string>("window.__emu.selection()")).not.toBe("");
    await click(".window-title");
    expect(await read<string>("window.__emu.selection()")).toBe("");
  } finally {
    await selectionDaemon.stop();
  }
}, 180_000);
