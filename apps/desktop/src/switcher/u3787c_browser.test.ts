import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { appServer } from "../testing/appServer";
import { captureDir } from "../testing/captures";

const exec = promisify(execFile);

it("u3787c_switcher_keyboard_entry_selection_and_native_query_in_the_mounted_App", async () => {
  const server = await appServer();
  const origin = server.resolvedUrls.local[0]!;
  const session = `switcher-list-${process.pid}`;
  const profile = mkdtempSync(join(tmpdir(), "switcher-list-"));

  const browser = async (...args: string[]) => {
    try {
      return (await exec("agent-browser", ["--session", session, "--json", ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 25_000 })).stdout;
    } catch (failure) {
      if (failure instanceof Error && "stdout" in failure) throw new Error(`${failure.message}\n${String(failure.stdout)}`, { cause: failure });

      throw failure;
    }
  };

  const read = async <T,>(expression: string): Promise<T> => {
    // SAFETY: agent-browser's JSON envelope holds the result of these constant DOM expressions.
    const result = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

    if (!result.success) throw new Error(result.error);

    return result.data.result;
  };

  const captures = captureDir("U3787c");

  const capture = async (name: string) => {
    if (!captures) return;
    await browser("screenshot", join(captures, `${name}.png`));
    writeFileSync(join(captures, `${name}.checks.json`), JSON.stringify(await read("window.__checks()"), null, 2));
  };

  try {
    if (captures) mkdirSync(captures, { recursive: true });
    await browser("--profile", profile, "open", new URL("/harness.html?seed=tree-40", origin).href);
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");

    for (const seed of ["tree-40", "tabs-8", "conflict", "agents-10"]) {
      // Seeds share an origin and Project path; begin each mounted observation with fresh drafts.
      await read("localStorage.clear()");
      await browser("open", new URL(`/harness.html?seed=${seed}`, origin).href);
      await browser("wait", "--fn", "!!window.__fake && !!document.querySelector('.rail-row')");

      if (captures) {
        await browser("record", "start", join(captures, `${seed}.webm`));
        // Recording creates a fresh page; wait for its production App before opening.
        await browser("wait", "--fn", "!!window.__fake && !!document.querySelector('.rail-row')");
      }

      await browser("set", "media", "dark");

      if (seed === "tabs-8") {
        // The tab seed's secondary Daemons replace the fake's primary binding; extend the
        // first Project explicitly so its owned content, including duplicate Unicode names, is dense.
        await read("(() => { const app=window.__fake.app.of('/Users/you/harness'); const base=window.__fake.app.handlers['rail.tree']()[0]; app.handlers['rail.tree']=()=>Array.from({length:8},(_,i)=>({...base,id:'switcher-'+i,name:i<2?'調査 é 🧭':'調査 é 🧭 '+i+' '+ 'Long name '.repeat(4),parent:null,order:i,terminal_id:null})); app.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'}); })()");
        // The first tab can be clipped by the overflow strip; use its native keyboard activation.
        await browser("focus", '.project-tab[data-path="/Users/you/harness"] .tab-name-button');
        await browser("press", "Enter");
        await browser("wait", "--fn", `document.querySelectorAll('.rail-row[data-id^="switcher-"]').length === 8`);
      }

      await browser("press", "Meta+k");
      await browser("press", "k");
      await browser("wait", "--fn", "!!document.querySelector('.switcher input') && document.activeElement === document.querySelector('.switcher input')");
      await browser("fill", ".switcher input", "");
      const before = await read<number>("window.__fake.app.calls.length");
      const ids = await read<string[]>("[...document.querySelectorAll('.switcher [data-collection-value]')].map(e=>e.dataset.value)");
      expect(ids.length).toBeGreaterThanOrEqual(5);

      if (seed !== "agents-10") await capture(`${seed}-before`);

      // Native Tab from the query reaches the content list, not a manufactured focus event.
      await browser("press", "Tab");
      await browser("wait", "--fn", "!!document.activeElement?.dataset.collectionValue");
      await browser("press", "End");
      expect(await read("document.activeElement.dataset.value")).toBe(ids.at(-1));
      await browser("press", "ArrowDown");
      expect(await read("document.activeElement.dataset.value")).toBe(ids.at(-1));
      await browser("press", "Home");
      expect(await read("document.activeElement.dataset.value")).toBe(ids[0]);
      await browser("press", "Meta+a");
      expect(await read("[...document.querySelectorAll('.switcher [aria-selected=true]')].map(e=>e.dataset.value)")).toEqual(ids);
      expect(await read("window.__fake.app.calls.length")).toBe(before);
      await browser("press", "ArrowDown");
      await capture(`${seed}-selected`);
      await browser("press", "Shift+Tab");
      await browser("wait", "--fn", "document.activeElement?.matches('.switcher input')");
      await browser("fill", ".switcher input", "  é 🧭 東京  ");
      // The native Linux editor uses Control; the App's content selection above uses Meta.
      await browser("press", process.platform === "darwin" ? "Meta+a" : "Control+a");
      expect(await read("[document.activeElement.selectionStart,document.activeElement.selectionEnd,document.activeElement.value]")).toEqual([0, 12, "  é 🧭 東京  "]);

      await browser("press", "Home");
      expect(await read("[document.activeElement.selectionStart,document.activeElement.selectionEnd]")).toEqual([0, 0]);
      await browser("press", "End");
      expect(await read("[document.activeElement.selectionStart,document.activeElement.selectionEnd]")).toEqual([12, 12]);

      if (seed === "tree-40") {
        await read("(() => { Storage.prototype.setItem=()=>{throw new Error('full')}; const f=document.querySelector('.switcher input'); f.value+='!'; f.dispatchEvent(new Event('input',{bubbles:true})); })()");
        await browser("wait", "--fn", "!!document.querySelector('.switcher [role=alert]')");
        await capture(`${seed}-retention-failure`);
      }

      await browser("press", "Escape");
      await browser("wait", "--fn", "!document.querySelector('.switcher')");

      if (captures) await browser("record", "stop");
    }
  } finally {
    try { await browser("close"); }
    finally { rmSync(profile, { recursive: true, force: true }); await server.close(); }
  }
}, 180_000);

type NameObserver = {
  browser: (...args: string[]) => Promise<string>;
  read: <T>(expression: string) => Promise<T>;
  active: (value: string) => Promise<void>;
  options: () => Promise<string[]>;
  open: () => Promise<void>;
  capture: (name: string) => Promise<void>;
};

const observeName = async (run: (observer: NameObserver) => Promise<void>) => {
  const server = await appServer();
  const session = `switcher-name-${process.pid}`;
  const profile = mkdtempSync(join(tmpdir(), "switcher-name-"));
  const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--json", ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 25_000 })).stdout;
  const read = async <T,>(expression: string): Promise<T> => {
    // SAFETY: agent-browser wraps these constant DOM expressions in its JSON envelope.
    const result = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

    if (!result.success) throw new Error(result.error);

    return result.data.result;
  };
  const active = async (value: string) => {
    await browser("wait", "--fn", `(() => { const f=document.querySelector('.switcher input'); const rows=[...document.querySelectorAll('.switcher [data-highlighted]')]; return rows.length===1 && rows[0].dataset.value===${JSON.stringify(value)} && f?.getAttribute('aria-activedescendant')===rows[0].id; })()`);
  };
  const options = () => read<string[]>("[...document.querySelectorAll('.switcher [role=option]')].map(e=>e.dataset.value)");
  const open = async () => {
    await browser("press", "Meta+k");
    await browser("press", "k");
    await browser("wait", "--fn", "document.activeElement?.matches('.switcher input')");
    await active((await options())[0]!);
  };
  const directory = captureDir("U4682");
  const capture = async (name: string) => {
    if (!directory) return;
    const head = join(directory, "head");

    mkdirSync(head, { recursive: true });
    await browser("screenshot", join(head, `${name}.png`));
    writeFileSync(join(head, `${name}.checks.json`), JSON.stringify(await read("window.__checks()"), null, 2));
  };

  try {
    await browser("--profile", profile, "open", new URL("/harness.html?seed=tree-40", server.resolvedUrls.local[0]!).href);
    await browser("set", "viewport", "1280", "800");
    await browser("set", "media", "dark");
    await browser("wait", "--fn", "!!window.__fake && !!document.querySelector('.rail-row[data-id=backend]')");
    await browser("click", ".rail-row[data-id=backend]");
    await browser("wait", "--fn", "document.querySelector('.rail-row[data-id=backend]')?.dataset.selected==='true'");
    await run({ browser, read, active, options, open, capture });
  } finally {
    try { await browser("close"); }
    finally { rmSync(profile, { recursive: true, force: true }); await server.close(); }
  }
};

// Normal reads may continue while Name is focused; only effects would violate navigation.
const effects = "window.__fake.app.calls.filter(c=>/\\.(spawn|create|open|write|remove|delete|send|assign|setAuto)$/.test(c.method))";
const selection = "[...document.querySelectorAll('.rail-row[data-selected=true]')].map(e=>e.dataset.id)";

it("u4682_name_opens_with_the_first_row_and_navigates_without_selection", async () => {
  await observeName(async ({ browser, read, active, options, open, capture }) => {
    const before = await read(effects);
    await open();
    const values = await options();
    const boundary = values.findIndex(value => value.startsWith("action:"));
    expect(boundary).toBeGreaterThan(0);
    await capture("opening");

    for (const [key, order] of [
      ["ArrowUp", [values[0]!]],
      ["ArrowDown", [...values.slice(1), values.at(-1)!]],
      ["ArrowUp", [...values.slice(0, -1).reverse(), values[0]!]],
    ] as const) {
      for (const value of order) {
        await browser("press", key);
        await active(value);
        expect(await read("document.activeElement?.matches('.switcher input')")).toBe(true);
        expect(await read(selection)).toEqual(["backend"]);
        expect(await read("document.querySelectorAll('.switcher [aria-selected=true]').length")).toBe(0);
        expect(await read(effects)).toEqual(before);
        if (key === "ArrowDown" && value === values[boundary]) await capture("boundary");
        if (key === "ArrowDown" && value === values.at(-1)) await capture("last-action");
      }
    }

    await browser("set", "viewport", "1512", "950");
    await capture("journey-opening");
    await browser("fill", ".switcher input", "New Terminal");
    await active("action:chord:⌘T");
    await read("window.__fake.failNext(-32003,'Terminal creation rejected: choose another name and try again')");
    await browser("press", "Enter");
    await browser("wait", "--fn", "!document.querySelector('.switcher') && [...document.querySelectorAll('[role=alert]')].some(e=>e.textContent.includes('Terminal creation rejected'))");
    await capture("rejected-action");
  });
}, 180_000);

it.each(["destination", "action"] as const)("u4682_enter_activates_only_the_row_reached_from_name: %s", async choice => {
  await observeName(async ({ browser, read, active, options, open }) => {
    const before = await read(effects);
    await open();
    const values = await options();
    const target = choice === "destination" ? "auth" : "action:chord:⌘N";
    const index = values.indexOf(target);
    expect(index).toBeGreaterThan(0);
    // Approach from both directions, so Enter cannot accidentally use a stale down-arrow row.
    for (const value of values.slice(1, index + 2)) {
      await browser("press", "ArrowDown");
      await active(value);
    }
    await browser("press", "ArrowUp");
    await active(target);
    expect(await read(selection)).toEqual(["backend"]);
    expect(await read(effects)).toEqual(before);
    await browser("press", "Enter");
    await browser("wait", "--fn", "!document.querySelector('.switcher')");
    if (choice === "destination") {
      await browser("wait", "--fn", "document.querySelector('.rail-row[data-id=auth]')?.dataset.selected==='true' && document.activeElement?.matches('.thread-composer textarea')");
      expect(await read(selection)).toEqual(["auth"]);
      expect(await read(effects)).toEqual(before);
    } else {
      await browser("wait", "--fn", "window.__fake.app.calls.some(c=>c.method==='agent.spawn')");
      expect(await read("window.__fake.app.calls.filter(c=>c.method==='agent.spawn').map(c=>c.params)")).toEqual([
        { cwd: "/Users/you/harness", prompt: null, parent: "backend", model: null, effort: null },
      ]);
      expect(await read("window.__fake.app.calls.filter(c=>c.method==='terminal.write')")).toEqual([]);
    }
  });
}, 180_000);

it("u4682_pointer_preserves_keyboard_highlight_and_query_caret", async () => {
  await observeName(async ({ browser, read, active, options, open }) => {
    await open();
    await browser("fill", ".switcher input", "agent");
    const values = await options();
    expect(values.length).toBeGreaterThan(2);
    await active(values[0]!);
    await browser("press", "ArrowLeft");
    await browser("press", "ArrowLeft");
    const before = await read("[document.activeElement.value,document.activeElement.selectionStart,document.activeElement.selectionEnd]");
    expect(before).toEqual(["agent", 3, 3]);
    const calls = await read(effects);
    for (const [key, value] of [["ArrowDown", values[1]!], ["ArrowUp", values[0]!]]) {
      await browser("press", key!);
      await active(value!);
      await browser("hover", `.switcher [data-value=${JSON.stringify(values[2])}]`);
      await active(value!);
      await browser("mouse", "move", "0", "0");
      await active(value!);
      expect(await read("document.activeElement?.matches('.switcher input')")).toBe(true);
      expect(await read("[document.activeElement.value,document.activeElement.selectionStart,document.activeElement.selectionEnd]")).toEqual(before);
      expect(await read(selection)).toEqual(["backend"]);
      expect(await read("document.querySelectorAll('.switcher [aria-selected=true]').length")).toBe(0);
      expect(await read(effects)).toEqual(calls);
    }
  });
}, 180_000);
