import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";
import { appServer } from "../testing/appServer";
import type { AppServer } from "../testing/appServer";
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromePath } from "../testing/chromePage";
import { captureDir } from "../testing/captures";
import baselineFixture from "./u472_baseline.json";
import { CHECK_IDS } from "../testing/checks";
import type { Checks } from "../testing/checks";

const execute = promisify(execFile);

const art = captureDir("U472");

const seeds = ["first-run", "agents-10", "tree-40", "door-stopped", "decisions", "conflict"];

let server: AppServer;

let baseServer: ViteDevServer | undefined;

let profile: string;

let origin: string;

let baseOrigin: string | undefined;

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

const clickText = (text: string, selector = "button") => evaluate(`(() => {
  const element = [...document.querySelectorAll(${JSON.stringify(selector)})].find(each => (each.getAttribute('aria-label') ?? each.textContent.trim()) === ${JSON.stringify(text)});
  if (!element) throw new Error('Missing action: ' + ${JSON.stringify(text)});
  element.click();
})()`);

beforeAll(async () => {
  profile = await mkdtemp(join(tmpdir(), "u472-browser-"));
  await writeFile(join(profile, "config.json"), "{}");
  server = await appServer();
  origin = server.resolvedUrls.local[0]!;
  const baselineRoot = process.env.ROUNDUP_COPY_BASE_ROOT;

  if (baselineRoot) {
    baseServer = await createServer({ root: join(baselineRoot, "apps/desktop"), cacheDir: join(profile, "vite-base"), server: { port: 0, strictPort: false, hmr: false }, logLevel: "silent" });
    await baseServer.listen();
    baseOrigin = baseServer.resolvedUrls!.local[0]!;
  }
}, 60_000);

afterAll(async () => {
  try { if (profile) await browser("close"); } finally {
    await server?.close();
    await baseServer?.close();

    if (profile) await rm(profile, { recursive: true, force: true });
  }
});

const load = async (base: string, seed: string, width: number, scheme: string) => {
  await browser("set", "viewport", String(width), "800");
  await browser("set", "media", scheme);
  await browser("open", `${base}harness.html?seed=${seed}`);
  await wait("Boolean(window.__fake && window.__checks && document.querySelector('.window'))");
  await evaluate("localStorage.clear()");
  await browser("reload");
  await wait("Boolean(window.__fake && window.__checks && document.querySelector('.window'))");
  await evaluate("document.fonts.ready.then(() => true)");
};

const capture = async (side: "base" | "head", name: string, checks: Checks) => {
  if (!art) return;
  await mkdir(join(art, side), { recursive: true });
  await browser("screenshot", join(art, side, `${name}.png`));
  await writeFile(join(art, side, `${name}.checks.json`), JSON.stringify(checks, null, 2));
};

const readChecks = async (): Promise<Checks> => evaluate("window.__checks()");

type Inventory = { text: string[]; names: string[] };

// SAFETY: the committed pre-migration fixture contains Checks status literals; JSON imports widen them to strings.
const baselineReadings = baselineFixture as Record<string, { checks: Checks; inventory?: Inventory }>;

const inventory = async (): Promise<Inventory> => evaluate(`(() => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const text = [];
  for (let node; (node = walker.nextNode());) {
    if (node.parentElement?.closest('script, style, .xterm, .resource-project')) continue;
    const value = node.textContent.replace(/\\s+/g, ' ').trim();
    if (value) text.push(value);
  }
  // The composed Project panel repeats the selected Project's authored name.
  // Verify that binding, then count that name once in the historical copy inventory.
  const panel = document.querySelector('.window > [data-scope=tabs][role=tabpanel]');
  if (panel && panel.getAttribute('aria-label') !== document.querySelector('.header [role=tab][aria-selected=true] .tab-name')?.textContent) throw new Error('Project panel name differs from the selected Project');
  const names = [...document.querySelectorAll('[aria-label], [title], [placeholder]')].flatMap(element =>
    element.closest('.resource-project') ? [] : ['aria-label', 'title', 'placeholder'].map(name => element === panel && name === 'aria-label' ? null : element.getAttribute(name)).filter(value => value));
  return {text, names};
})()`);

// U520: a Rail row's native `title` became a Tooltip, so its text is no accessible-name attribute in the DOM; the retired baseline names are the titles that were not an aria-label, and a title repeating its element's aria-label sat right after it.
const RETIRED_TITLES = /^(error|needs-you|blocked|working|idle) label \d+$|^Add Agent ⌘N$|^Clear$|^\d+ need you$|^editing src\/auth\/token\.rs$|^tests failed: 3$|^asks: keep v1 routes\?/;

const withoutTitles = (names: string[]) => names.filter((value) => !RETIRED_TITLES.test(value)).filter((value, index, all) => value !== all[index - 1]);

const mapped = (value: string): string => {
  const labels = new Map([
    [['Start', 'Door'].join(' '), 'Start supervisor'], [['Retry', 'Door'].join(' '), 'Retry supervisor'],
    [['End', 'Takeover'].join(' '), 'Give control back'], [['Take', 'over'].join(' '), 'Take control'],
    [['Show', 'Shelf'].join(' '), 'Show work items'], [['Hide', 'Shelf'].join(' '), 'Hide work items'],
    ['Shelf', 'Work items'], ['shelf', 'Work items'], ['rail', 'Rail'], ['centre', 'Centre'],
    ['Resize Shelf', 'Resize work items'], ['Shelf keys', 'Work items keys'],
    ['agents and terminals', 'Workstreams and Agents'],
    ['appear here, one per row,', 'appear here, one per row,'],
    ['nested by indent', 'nested by indent'], ['plan; so can you', 'plan; so can you'],
  ]);

  const exact = labels.get(value);

  if (exact) return exact;

  if (value.startsWith('Door stopped')) return value.replace('Door stopped', 'Supervisor stopped');

  if (['agents and terminals', 'appear here, one per row,', 'nested by indent', 'open a folder to start', 'choose folder…', 'todos', 'agents add them as they', 'plan; so can you', 'pads', 'agent notes', 'yours', 'reopen', 'asking the Door…'].includes(value)) return value[0]!.toUpperCase() + value.slice(1).replace('Door', 'supervisor');

  return value;
};

// Copy changes no layout and no colour: one window represents every supported width, and light every scheme.
// D5 reads dark once, on the densest seed.
const width = 1280;

for (const [seed, scheme] of [...seeds.map((seed) => [seed, "light"] as const), ["tree-40", "dark"] as const]) {
  it(`u472_copy_preserves_rendered_checks ${seed} ${width} ${scheme}`, async () => {
    const name = `${seed}-${width}x800-${scheme}`;
    let baseline: Checks;
    let before: Inventory;

    if (baseOrigin) {
      await load(baseOrigin, seed, width, scheme);
      baseline = await readChecks();
      before = await inventory();
      await capture("base", name, baseline);

      if (art) await writeFile(join(art, "base", `${name}.inventory.json`), JSON.stringify(before, null, 2));
    } else {
      baseline = baselineReadings[name]!.checks;
      before = baselineReadings[name]!.inventory!;
    }

    await load(origin, seed, width, scheme);
    const head = await readChecks();
    const after = await inventory();

    expect(after.text, `${name} text`).toEqual(before.text.map(mapped));
    expect(withoutTitles(after.names), `${name} accessible names`).toEqual(withoutTitles(before.names.map(mapped)));

    for (const id of CHECK_IDS) if (baseline[id].status === "pass") expect(head[id].status, `${name} ${id}`).toBe("pass");

    for (const id of ["D2", "D5", "D6"] as const) expect(head[id].status, `${name} ${id}`).toBe("pass");
    await capture("head", name, head);
  }, 60_000);
}

const baselineFailure = async (width: number, scheme: string): Promise<Checks> => {
  const name = `failed-clear-${width}x800-${scheme}`;

  if (!baseOrigin) return baselineReadings[name]!.checks;

  await load(baseOrigin, "tree-40", width, scheme);
  await browser("click", '.rail-row[data-id="payments"]');
  await wait("Boolean(document.querySelector('.pane-screen'))");
  await clickText(['Hide', 'Shelf'].join(' '));
  await evaluate("window.__fake.app.handlers['workstream.clear'] = () => ({pending: true})");
  await clickText("More");
  await clickText("Clear…", "[role=menuitem]");
  await browser("fill", "[data-clear-prompt] textarea", "keep MY reason 🧭  exactly");
  await clickText("Clear", "[data-clear-prompt] button");
  await wait("document.querySelector('[data-clear-prompt] textarea').disabled");
  await evaluate(`window.__fake.emit({actor: {kind:'user', id:'you', parent:null}, name:'workstream.clearFailed', data:{id:'payments', code:-32008, message:'summary refused: keep THIS failure 🧭'}})`);
  await wait("document.querySelector('[data-clear-prompt] [role=alert]')?.textContent.includes('keep THIS failure')");
  const checks = await readChecks();

  await capture("base", name, checks);

  return checks;
};

// The journey is behaviour: one scheme represents both.
it("u472_copy_preserves_journey_actions_and_failure_text", async () => {
  await load(origin, "first-run", width, "light");
  await evaluate("window.__fake.app.chooser.path = '/Users/you/harness'");
  await browser("focus", ".centre button");
  await browser("press", "Enter");
  await wait("document.body.textContent.includes('New Workstream')");
  await clickText("New Workstream");
  await wait("Boolean(document.querySelector('.pane-screen'))");
  expect(await evaluate("window.__fake.app.calls.filter(call => call.method === 'rail.startDoor').length")).toBe(1);

  await clickText("Hide work items");
  await wait("document.querySelector('.shelf').hidden");
  await clickText("Show work items");
  await wait("!document.querySelector('.shelf').hidden && document.querySelector('.shelf').dataset.open === 'true' && document.querySelector('.shelf').getBoundingClientRect().right <= innerWidth + 1");
  await clickText("Hide work items");
  await load(origin, "door-stopped", width, "light");
  await wait("Boolean(document.querySelector('.pane-screen'))");
  await evaluate(`(() => {
    const app = window.__fake.app;
    const start = app.handlers['rail.startDoor'];
    app.handlers['rail.startDoor'] = () => {
      app.handlers['rail.startDoor'] = start;
      throw new Error('keep THIS launch failure 🧭');
    };
    [...document.querySelectorAll('button')].find(element => element.getAttribute('aria-label') === 'Start supervisor').click();
  })()`);
  await wait("document.body.textContent.includes('keep THIS launch failure') && !!document.querySelector('[aria-label=\"Retry supervisor\"]')");
  await clickText("Retry supervisor");
  await wait("window.__fake.app.calls.filter(call => call.method === 'rail.startDoor').length === 2");
  expect(await evaluate("window.__fake.app.calls.filter(call => call.method === 'rail.startDoor').map(call => call.params)")).toEqual([{id:'first-workstream'}, {id:'first-workstream'}]);
  expect(await evaluate("window.__fake.app.calls.filter(call => call.method === 'rail.createWorkstream')")).toEqual([]);
  const beforeFailure = await baselineFailure(width, "light");

  // The densest seed supplies a real Workstream with descendants. Inject at the existing fake seam only.
  await load(origin, "tree-40", width, "light");
  await browser("click", '.rail-row[data-id="payments"]');
  await wait("Boolean(document.querySelector('.pane-screen'))");
  await clickText("Hide work items");
  await evaluate(`(() => {
    const app = window.__fake.app;
    app.handlers['workstream.clear'] = () => ({pending: true});
    window.__u472TreeBefore = document.querySelectorAll('[role=treeitem]').length;
  })()`);
  await evaluate(`document.querySelector('[data-id="payments"] [aria-label="Clear Workstream…"]').click()`);
  await browser("fill", "[data-clear-prompt] textarea", "keep MY reason 🧭  exactly");
  await clickText("Clear and keep a summary");
  await wait("document.body.textContent.includes('The supervisor is writing the summary')");
  expect(await evaluate("window.__fake.app.calls.filter(call => call.method === 'workstream.clear').map(call => call.params)")).toEqual([{ id: "payments", reason: "keep MY reason 🧭  exactly" }]);
  await evaluate(`window.__fake.emit({actor: {kind:'user', id:'you', parent:null}, name:'workstream.clearFailed', data:{id:'payments', code:-32008, message:'summary refused: keep THIS failure 🧭'}})`);
  await wait("document.querySelector('[data-clear-prompt] [role=alert]')?.textContent.includes('keep THIS failure')");
  expect(await evaluate("document.querySelector('[data-clear-prompt] textarea').value")).toBe("keep MY reason 🧭  exactly");
  expect(await evaluate("document.querySelectorAll('[role=treeitem]').length === window.__u472TreeBefore")).toBe(true);
  const failure = await readChecks();

  for (const id of CHECK_IDS) if (beforeFailure[id].status === "pass") expect(failure[id].status, `${id} failed-clear baseline`).toBe("pass");

  for (const id of ["D2", "D5", "D6"] as const) expect(failure[id].status, `${id} failed clear`).toBe("pass");
  await capture("head", `failed-clear-${width}x800-light`, failure);
  await clickText("Clear without a summary");
  await wait("window.__fake.app.calls.filter(call => call.method === 'workstream.clear').length === 2");
  expect(await evaluate("window.__fake.app.calls.filter(call => call.method === 'workstream.clear')[1].params")).toEqual({ id: "payments", reason: "keep MY reason 🧭  exactly", without_handoff: true });
  await evaluate(`window.__fake.emit({actor: {kind:'user', id:'you', parent:null}, name:'workstream.cleared', data:{id:'payments', iteration:2}})`);
  await wait("!document.querySelector('[data-clear-prompt]')");
  await clickText("Show work items");
  await wait("document.querySelector('.shelf').dataset.open === 'true' && document.querySelector('.shelf').getBoundingClientRect().right <= innerWidth + 1");
  await clickText("Show all Workstreams");
  await wait("Boolean(document.querySelector('.shelf [data-id=\"2\"] .todo-row-button'))");
  await browser("click", '.shelf [data-id="2"] .todo-row-button');
  await wait("Boolean(document.querySelector('.drawer')) && document.body.textContent.includes('body text')");
  expect(await evaluate("document.body.textContent.includes('todo 2')")).toBe(true);

}, 120_000);
