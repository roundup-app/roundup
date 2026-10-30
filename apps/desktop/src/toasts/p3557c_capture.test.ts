import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, it } from "vitest";
import { appServer } from "../testing/appServer";
import type { AppServer } from "../testing/appServer";
import { captureDir } from "../testing/captures";

const execute = promisify(execFile);

const session = `p3557c-${process.pid}`;

let server: AppServer;

const browser = async (...args: string[]) => (await execute("agent-browser", ["--session", session, ...args], { timeout: 60_000 })).stdout;

beforeAll(async () => {
  server = await appServer();
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
}, 90_000);

afterAll(async () => {
  await browser("close");
  await server?.close();
});

const capture = async (step: string) => {
  const dir = captureDir("P3557c");

  if (!dir) return;
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${step}.checks.json`), JSON.stringify(JSON.parse(await browser("eval", "window.__checks()"))) + "\n");
  await browser("screenshot", join(dir, `${step}.png`));
};

it("p3557c_rendered_failure_clears_with_its_deleted_pad", async () => {
  await browser("open", `${server.resolvedUrls.local[0]}harness.html?view=workstreams&items=1&tabs=1&seed=tree-40`);
  await browser("wait", "[role=tree]");
  const pads = "window.__fake.app.handlers['pad.list']";
  const name = JSON.parse(await browser("eval", `window.__fake.app.rpc('pad.list').then(list => list[0].name)`));

  await browser("eval", `window.__fake.emit({ actor: { kind: 'agent', id: 'a', parent: null }, name: 'pad.changed', data: { name: ${JSON.stringify(name)} } })`);
  await browser("wait", ".app-toast-action");
  await browser("eval", `${pads} = () => []`);
  await browser("click", ".app-toast-action");
  await browser("wait", "[role=alert]");
  await capture("dark-failure-visible");
  await browser("eval", `window.__fake.emit({ actor: { kind: 'user', id: 'you', parent: null }, name: 'pad.deleted', data: { name: ${JSON.stringify(name)} } })`);
  await browser("wait", "--fn", "!document.querySelector('[role=alert]')");
  await capture("dark-failure-cleared");
  expect(JSON.parse(await browser("eval", "!!document.querySelector('[role=alert]')"))).toBe(false);
}, 60_000);
