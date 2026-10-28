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

const profile = mkdtempSync(join(tmpdir(), "u4424-"));

const session = `u4424-${process.pid}`;

const baseline = process.env.ROUNDUP_U4424_BASELINE === "1";

let server: AppServer;

let origin: string;

const browser = async (...args: string[]) => {
  try {
    return (await exec("agent-browser", ["--session", session, "--json", ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 60_000 })).stdout;
  } catch (error) {
    // SAFETY: promisified execFile rejects with its documented stdout/stderr fields.
    const failure = error as Error & { stdout?: string; stderr?: string };

    throw new Error(`${failure.message}\n${failure.stdout ?? ""}\n${failure.stderr ?? ""}`);
  }
};

const read = async <T,>(expression: string): Promise<T> => {
  // SAFETY: agent-browser eval returns its documented JSON response envelope.
  const reply = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

  if (!reply.success) throw new Error(reply.error);

  return reply.data.result;
};

const until = (predicate: string) => waitFor(async () => {
  if (!await read<boolean>(predicate)) throw new Error(`Not observed: ${predicate}`);
}, { timeout: 15_000, interval: 100 });

const capture = async (id: string, step: string) => {
  const directory = captureDir(id);

  if (!directory) return;
  const target = join(directory, baseline ? "base" : "head");
  mkdirSync(target, { recursive: true });
  await browser("screenshot", join(target, `${step}.png`));
  const observed = await read<{ checks: unknown }>(`({checks:window.__checks(), shown:[...document.querySelectorAll('.bubble:not([hidden])')].map(b=>b.dataset.bubble), connected:window.__hostProbe?.bubble?.isConnected, same:window.__hostProbe?.bubble === document.querySelector('.bubble:not([hidden])'), focused:document.activeElement?.className, menu:window.__fake.app.shownMenus.at(-1)?.items.map(i=>i.label), failure:document.querySelector('.bubbles [role=alert]')?.textContent})`);
  writeFileSync(join(target, `${step}.checks.json`), JSON.stringify(observed.checks, null, 2));
  writeFileSync(join(target, `${step}.observation.json`), JSON.stringify(observed, null, 2));
};

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

it("u4424a_u4424b_rendered_host_absence_replacement_and_dense_failure", async () => {
  const directory = captureDir("U4424b");

  if (directory) {
    const target = join(directory, baseline ? "base" : "head");
    mkdirSync(target, { recursive: true });
    await browser("record", "start", join(target, "interaction.webm"));
  }

  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
  await browser("open", new URL("/harness.html?view=workstreams&items=1&tabs=1&seed=bubbles", origin).href);
  await until("!!window.__fake && !!document.querySelector('[data-id=dense]')");
  await read("document.querySelector('[data-id=dense] .name').click()");
  await until("document.querySelectorAll('.bubble').length >= 8");
  await capture("U4424b", "dense");
  await read(`(() => {
    const host = document.querySelector('.resource-strip');
    window.__hostProbe = {host, parent:host.parentElement, next:host.nextSibling};
    host.remove();
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'t',code:'KeyT',metaKey:true,bubbles:true,cancelable:true}));
  })()`);
  await until("window.__fake.app.calls.some(c=>c.method==='terminal.open') && !!document.querySelector('.bubble:not([hidden])')");
  await capture("U4424a", "opened-without-host");
  await read("window.__hostProbe.parent.insertBefore(window.__hostProbe.host,window.__hostProbe.next)");
  await until("!!document.querySelector('.resource-strip')");
  await read("window.__hostProbe.bubble = document.querySelector('.bubble:not([hidden])'); window.__fake.writeOutput(window.__hostProbe.bubble.dataset.bubble,'retained before removal\\r\\n'); window.__hostProbe.host.remove()");
  await until("!document.querySelector('.resource-strip')");
  await capture("U4424b", "absent");

  if (!baseline) expect(await read("window.__hostProbe.bubble.isConnected")).toBe(true);
  await read("window.__fake.writeOutput(window.__hostProbe.bubble.dataset.bubble,'output while host absent\\r\\n'); window.__hostProbe.parent.insertBefore(document.createElement('span'),window.__hostProbe.next).className='resource-strip'");

  if (!baseline) await until("!!document.querySelector('.resource-strip')");
  await capture("U4424b", "replaced");

  if (!baseline) expect(await read("window.__hostProbe.bubble === document.querySelector('.bubble:not([hidden])') && window.__hostProbe.bubble.isConnected")).toBe(true);
  await read("document.querySelector('.bubble:not([hidden]) .bubble-header').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:650,clientY:250}))");
  await until("window.__fake.app.shownMenus.length === 1");
  await capture("U4424b", "header-menu");
  await read("window.__fake.app.closeMenu()");
  await read(`(() => {
    const header=document.querySelector('.bubble:not([hidden]) .bubble-header');
    for (const [type,x,buttons] of [['pointerdown',600,2],['contextmenu',600,2],['pointermove',630,2],['pointerup',630,0]]) header.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,button:2,buttons,clientX:x,clientY:250,pointerType:'mouse'}));
  })()`);
  expect(await read("window.__fake.app.shownMenus.length")).toBe(1);

  if (baseline) await read("document.querySelector('.resource-strip').replaceWith(window.__hostProbe.host)");
  await read("window.dispatchEvent(new CustomEvent('roundup:reveal-bubble', {detail: document.querySelector('.bubble[data-bubble=\"110\"]').dataset.bubble}))");
  await until("!!document.querySelector('.bubble[data-bubble=\"110\"]:not([hidden])')");
  await read("window.__fake.app.handlers['terminal.close']=()=>{throw new Error('Cannot close Terminal: shell is busy. Stop the command and retry.');}; document.querySelector('.bubble:not([hidden]) [aria-label=Close]').click()");
  await until("!!window.__question.answer");
  await read("window.__question.answer(true)");
  await until("document.querySelector('.bubbles [role=alert]')?.textContent.includes('Stop the command and retry.')");
  await read("document.querySelector('.bubbles .bubble-failure button').focus()");
  await capture("U4424b", "dense-failure");

  if (directory) await browser("record", "stop");
}, 90_000);
