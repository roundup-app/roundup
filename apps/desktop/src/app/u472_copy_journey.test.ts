import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { appServer } from "../testing/appServer";
import type { AppServer } from "../testing/appServer";
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromePath } from "../testing/chromePage";

const execute = promisify(execFile);

let server: AppServer;

let profile: string;

let origin: string;

const session = `u472-builder-38499215487-${process.pid}`;

const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_")));

const browser = async (...args: string[]) => {
  const executable = chromePath();

  if (!executable) throw new Error("U472 needs isolated headless Chrome: set CHROME_PATH");
  const { stdout } = await execute("agent-browser", ["--executable-path", executable, "--args", "--no-sandbox", "--config", join(profile, "config.json"), "--session", session, "--profile", profile, "--json", ...args], { env, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
  const reply = JSON.parse(stdout);
  expect(reply.success, stdout).toBe(true);

  return reply.data;
};

const evaluate = async (expression: string) => (await browser("eval", expression)).result;

const wait = (expression: string) => browser("wait", "--fn", expression);

beforeAll(async () => {
  profile = await mkdtemp(join(tmpdir(), "u472-browser-"));
  await writeFile(join(profile, "config.json"), "{}");
  server = await appServer();
  origin = server.resolvedUrls.local[0]!;
}, 60_000);

afterAll(async () => {
  try { if (profile) await browser("close"); } finally {
    await server?.close();

    if (profile) await rm(profile, { recursive: true, force: true });
  }
});

const load = async (base: string, seed: string, width: number, scheme: string) => {
  await browser("set", "viewport", String(width), "800");
  await browser("set", "media", scheme);
  await browser("open", `${base}harness.html?view=workstreams&items=1&tabs=1&seed=${seed}&view=workstreams&items=1&tabs=1`);
  await wait("Boolean(window.__fake && document.querySelector('.window'))");
  await evaluate("localStorage.clear()");
  await browser("reload");
  await wait("Boolean(window.__fake && document.querySelector('.window'))");
  await evaluate("document.fonts.ready.then(() => true)");
};

// App boundary: Help over the overlay Shelf is not covered by the Bubble key proofs.
it("u2892c_backdrops_preserve_layer_key_ownership", async () => {
  await load(origin, "tree-40", 1512, "dark");
  await browser("set", "viewport", "1512", "950");
  await wait("Boolean(document.querySelector('.rail-row[data-id=\"payments\"]'))");
  await browser("click", '.rail-row[data-id="payments"] .name');
  await wait("Boolean(document.querySelector('.pane-screen textarea'))");
  // Layout measures this Token-derived floor on resize, as the U2892 capture observer does.
  await evaluate(`document.querySelector('.window').style.setProperty('--centre-min-width', String(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--space-6')) * 40) + 'px')`);
  await browser("set", "viewport", "1511", "950");
  await browser("set", "viewport", "1512", "950");
  await wait("document.querySelector('.window').dataset.shelfMode === 'overlay' && !!document.querySelector('.shelf-scrim')");

  const pressAt = async (selector: string) => {
    const at = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);

    await browser("mouse", "move", String(Math.round(at.x)), String(Math.round(at.y)));
    await browser("mouse", "down", "left");
    await browser("mouse", "up", "left");
  };

  for (const dismissal of ["Escape", "outside"] as const) {
    await browser("focus", '.rail-row[data-id="payments"]');
    await evaluate("window.__backdropReturn = document.activeElement; window.__backdropStart = window.__fake.app.calls.length");
    await browser("press", "?");
    await wait("!!document.activeElement?.closest('.help')");
    await browser("press", "Meta+t");
    await browser("press", "Meta+b");
    await browser("press", "Enter");
    expect(await evaluate("!!document.activeElement?.closest('.help')")).toBe(true);

    if (dismissal === "Escape") await browser("press", "Escape");
    else await pressAt('.rail [aria-label="Add Workstream"]');

    await wait("!document.querySelector('.help') && document.activeElement === window.__backdropReturn");
    expect(await evaluate(`({shelf:document.querySelector('.shelf').dataset.open, selected:document.querySelector('.rail-row[data-selected=true]')?.dataset.id, mutations:window.__fake.app.calls.slice(window.__backdropStart).filter(c => ['terminal.open','terminal.close','terminal.write','agent.prompt','rail.createWorkstream','rail.startDoor','todo.delete','pad.delete'].includes(c.method))})`)).toEqual({ shelf: "true", selected: "payments", mutations: [] });
  }

  // The visual scrim extends over the header, whose controls remain reachable.
  await browser("click", ".project-tab[data-selected] .tab-name-button");
  expect(await evaluate("!!document.activeElement?.closest('.project-tab') && document.querySelector('.shelf').dataset.open === 'true'")).toBe(true);
  await browser("focus", '.rail-row[data-id="payments"]');
  await evaluate("window.__backdropReturn = document.activeElement; window.__backdropStart = window.__fake.app.calls.length");
  // The pane is in the scrim's existing dismissal target. Its press closes only the Shelf.
  await pressAt(".pane-screen");
  await wait("document.querySelector('.shelf').hidden && !document.querySelector('.shelf-scrim')");
  expect(await evaluate(`({focus:document.activeElement === window.__backdropReturn, mutations:window.__fake.app.calls.slice(window.__backdropStart).filter(c => ['terminal.open','terminal.close','terminal.write','agent.prompt','rail.createWorkstream','rail.startDoor','todo.delete','pad.delete'].includes(c.method))})`)).toEqual({ focus: true, mutations: [] });
}, 120_000);
