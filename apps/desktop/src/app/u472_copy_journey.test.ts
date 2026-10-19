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
  await browser("open", `${base}harness.html?seed=${seed}`);
  await wait("Boolean(window.__fake && document.querySelector('.window'))");
  await evaluate("localStorage.clear()");
  await browser("reload");
  await wait("Boolean(window.__fake && document.querySelector('.window'))");
  await evaluate("document.fonts.ready.then(() => true)");
};

// One scheme represents both.
const width = 1280;

it("u472_copy_preserves_journey_actions_and_failure_text", async () => {
  await load(origin, "first-run", width, "light");
  await evaluate("window.__fake.app.chooser.path = '/Users/you/harness'");
  await browser("focus", ".centre button");
  await browser("press", "Enter");
  await wait("document.body.textContent.includes('New Workstream')");
  await clickText("New Workstream");
  await wait("Boolean(document.querySelector('.pane-screen'))");
  expect(await evaluate("window.__fake.app.calls.filter(call => call.method === 'rail.startDoor').length")).toBe(1);

  await browser("click", "#shelf-tab-todos");
  await wait("document.querySelector('.shelf').hidden");
  await browser("click", "#shelf-tab-todos");
  await wait("!document.querySelector('.shelf').hidden && document.querySelector('.shelf').dataset.open === 'true'");
  await browser("click", "#shelf-tab-todos");
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

  // The densest seed supplies a real Workstream with descendants. Inject at the existing fake seam only.
  await load(origin, "tree-40", width, "light");
  await browser("click", '.rail-row[data-id="payments"]');
  await wait("Boolean(document.querySelector('.pane-screen'))");
  await browser("click", "#shelf-tab-todos");
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
  await clickText("Clear without a summary");
  await wait("window.__fake.app.calls.filter(call => call.method === 'workstream.clear').length === 2");
  expect(await evaluate("window.__fake.app.calls.filter(call => call.method === 'workstream.clear')[1].params")).toEqual({ id: "payments", reason: "keep MY reason 🧭  exactly", without_handoff: true });
  await evaluate(`window.__fake.emit({actor: {kind:'user', id:'you', parent:null}, name:'workstream.cleared', data:{id:'payments', iteration:2}})`);
  await wait("!document.querySelector('[data-clear-prompt]')");
  await browser("click", "#shelf-tab-todos");
  await wait("document.querySelector('.shelf').dataset.open === 'true'");
  await browser("click", "[data-todo-root]");
  await wait("!document.querySelector('.rail-row[data-selected=true]')");
  await wait("Boolean(document.querySelector('.shelf [data-id=\"2\"] .todo-row-button'))");
  await browser("click", '.shelf [data-id="2"] .todo-row-button');
  await wait("Boolean(document.querySelector('.drawer')) && document.body.textContent.includes('body text')");
  expect(await evaluate("document.body.textContent.includes('todo 2')")).toBe(true);

}, 120_000);
