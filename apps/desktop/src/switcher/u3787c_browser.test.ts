import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { appServer } from "../testing/appServer";
import { captureDir } from "../testing/captures";

const exec = promisify(execFile);

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
        expect(await read(`({ focused: document.activeElement?.matches('.switcher input'), selected: ${selection}, content: document.querySelectorAll('.switcher [aria-selected=true]').length, effects: ${effects} })`)).toEqual({ focused: true, selected: ["backend"], content: 0, effects: before });

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
    const target = choice === "destination" ? "agent-1" : "action:chord:⌘N";
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
      await browser("wait", "--fn", "document.querySelector('.rail-row[data-id=agent-1]')?.dataset.selected==='true' && !!document.activeElement?.closest('.pane-screen')");
      expect(await read(selection)).toEqual(["agent-1"]);
      expect(await read(effects)).toEqual(before);
    } else {
      await browser("wait", "--fn", "window.__fake.app.calls.some(c=>c.method==='agent.spawn')");
      expect(await read("window.__fake.app.calls.filter(c=>c.method==='agent.spawn').map(({params:{cwd,prompt,parent,model,effort}})=>({cwd,prompt,parent,model,effort}))")).toEqual([
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
