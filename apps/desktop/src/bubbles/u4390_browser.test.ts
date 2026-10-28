import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { waitFor } from "@testing-library/dom";
import { appServer, type AppServer } from "../testing/appServer";
import { captureDir } from "../testing/captures";

const exec = promisify(execFile);

const profile = mkdtempSync(join(tmpdir(), "u4390-"));

const session = `u4390-${process.pid}`;

const baseline = process.env.ROUNDUP_U4390_BASELINE === "1";

let server: AppServer;

let origin: string;

const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--json", ...args], {
  maxBuffer: 8 * 1024 * 1024, timeout: 60_000,
})).stdout;

const read = async <T,>(expression: string): Promise<T> => {
  // SAFETY: agent-browser's eval command returns this JSON envelope.
  const reply = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

  if (!reply.success) throw new Error(reply.error);

  return reply.data.result;
};

const until = (predicate: string) => waitFor(async () => {
  if (!await read<boolean>(predicate)) throw new Error(`Not observed: ${predicate}`);
}, { timeout: 15_000, interval: 100 });

beforeAll(async () => {
  server = await appServer();
  origin = server.resolvedUrls.local[0]!;
  await browser("--profile", profile, "open", "about:blank");
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
}, 60_000);

afterAll(async () => {
  try { await browser("close"); } finally {
    await server?.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}, 60_000);

const capture = async (step: string) => {
  const directory = captureDir("U4390");

  if (!directory) return;
  const target = join(directory, baseline ? "base" : "head");
  mkdirSync(target, { recursive: true });
  await browser("screenshot", join(target, `${step}.png`));

  const observed = await read<{ checks: unknown }>(`({
    checks: window.__checks(),
    tabs: [...document.querySelectorAll('.bubble')].map(tab => tab.dataset.bubble),
    focused: document.activeElement?.outerHTML,
    shown: [...document.querySelectorAll('.bubble:not([hidden])')].map(bubble => bubble.dataset.bubble),
    root: document.querySelector('.todo-project-root')?.getAttribute('aria-pressed'),
    calls: window.__fake.app.calls.filter(call => ['terminal.open','terminal.close'].includes(call.method)),
    failure: document.querySelector('.bubbles [role="alert"]')?.textContent
  })`);

  writeFileSync(join(target, `${step}.checks.json`), JSON.stringify(observed.checks, null, 2));
  writeFileSync(join(target, `${step}.observation.json`), JSON.stringify(observed, null, 2));
};

it("u4390_rendered_root_open_first_listing_close_and_dense_failure", async () => {
  await browser("open", new URL("/harness.html?view=workstreams&items=1&tabs=1&seed=bubbles", origin).href);
  await until("!!window.__fake && !!document.querySelector('.todo-project-root')");
  await read(`(async () => {
    const app = window.__fake.app;
    const listed = await app.handlers['terminal.list'](null);
    app.handlers['terminal.snapshot'] = () => ({cols:100, rows:30, after:0, data:''});
    const project = {...listed[0], id:'project', incarnation:'project', owner:app.opened.project.path, title:'project shell'};
    window.__rootRace = {project};
    app.handlers['terminal.list'] = () => [project];
    document.querySelector('.todo-project-root').click();
    window.__fake.emit({name:'terminal.changed'});
  })()`);
  await until("document.querySelectorAll('.bubble').length === 1 && !!document.querySelector('.bubble[data-bubble=project]')");
  await capture("root");
  await read(`(() => {
    const app = window.__fake.app, race = window.__rootRace;
    race.opened = {...race.project, id:'root-new', incarnation:'root-new', owner:'first-workstream', title:'new shell'};
    app.handlers['terminal.open'] = () => new Promise(resolve => {race.ack = resolve;});
    race.lists = 0;
    app.handlers['terminal.list'] = () => new Promise(resolve => {
      if (++race.lists === 1) race.stale = resolve;
      else race.first = resolve;
    });
    window.dispatchEvent(new KeyboardEvent('keydown', {key:'t',code:'KeyT',metaKey:true,bubbles:true}));
    window.__fake.emit({name:'terminal.changed'});
  })()`);
  await until("!!window.__rootRace.stale && !!window.__rootRace.ack");
  await read("window.__rootRace.ack({terminal_id:'root-new'})");
  await read("window.__rootRace.stale([window.__rootRace.project])");
  await until("!!window.__rootRace.first");
  await capture("stale");
  await read(`(() => {
    const race = window.__rootRace;
    window.__fake.app.handlers['terminal.list'] = () => [race.project, race.opened];
    race.first([race.project, race.opened]);
  })()`);
  // The New Terminal control re-enables only after openTerminal joins its Rail refresh.
  await until("!document.querySelector('.bubbles').disabled");

  if (!baseline) {
    await until("document.activeElement?.closest('.bubble')?.dataset.bubble === 'root-new'");
    expect(await read("document.activeElement?.matches('.xterm-helper-textarea')")).toBe(true);
  }

  await capture("listed");
  await read("document.querySelector('[data-id=first-workstream] .name').click()");
  await until("document.querySelector('.todo-project-root').getAttribute('aria-pressed') === 'false'");
  await read("document.querySelector('.todo-project-root').click()");
  await until("document.querySelector('.todo-project-root').getAttribute('aria-pressed') === 'true'");
  await capture("returned");

  if (baseline) {
    await read("document.querySelector('[data-id=first-workstream] .name').click()");
    await until("!!document.querySelector('.bubble[data-bubble=root-new]')");
  }

  {
    await read(`(() => {
      const app = window.__fake.app, race = window.__rootRace;
      app.handlers['terminal.close'] = () => {app.handlers['terminal.list'] = () => [race.project]; return null;};
      document.querySelector('.bubble[data-bubble=root-new] [aria-label=Close]').click();
    })()`);
    await until("!!window.__question.answer");
    await read("window.__question.answer(true)");
    await until("!document.querySelector('.bubble[data-bubble=root-new]') && !document.querySelector('.bubble[data-bubble=root-new]')");
    await read("document.querySelector('.todo-project-root').click()");
    await until("document.querySelector('.todo-project-root').getAttribute('aria-pressed') === 'true'");
    await capture("closed");
  }

  await read(`(() => {
    const app = window.__fake.app, project = window.__rootRace.project;
    app.handlers['terminal.list'] = () => Array.from({length:16}, (_, index) => ({
      ...project, id:'dense-' + index, incarnation:'dense-' + index, owner:'first-workstream', title:'x'.repeat(60) + index
    }));
    document.querySelector('[data-id=first-workstream] .name').click();
    window.__fake.emit({name:'terminal.changed'});
  })()`);
  await until("document.querySelectorAll('.bubble').length === 16");
  await capture("dense");
  await read(`(() => {
    window.__fake.app.handlers['terminal.open'] = () => {throw new Error('Cannot open Terminal: shell unavailable. Check the shell path and retry.');};
    window.dispatchEvent(new KeyboardEvent('keydown', {key:'t',code:'KeyT',metaKey:true,bubbles:true}));
  })()`);
  await until("!document.querySelector('.bubbles').disabled && document.querySelector('.bubbles [role=alert]')?.textContent.includes('Check the shell path and retry.')");
  await capture("dense-failure");
}, 60_000);
