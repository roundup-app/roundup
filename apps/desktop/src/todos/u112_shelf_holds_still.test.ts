import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromePath, headlessChromeArgs } from "../testing/chromePage";
import { appServer, type AppServer } from "../testing/appServer";

/** U112 in a real Chromium: Vite serves the U26 harness and Chrome is driven over its DevTools pipe, so no package beyond a Chrome binary is needed. */

type Json = string | number | boolean | null | readonly Json[] | { readonly [name: string]: Json };

type Reply = { id?: number; result?: unknown; error?: { message: string } };

type Eval<T> = { result: { value: T }; exceptionDetails?: { text: string; exception?: { description: string } } };

const found = chromePath();

// A missing browser skips only off CI: on CI the claim must be checked, never silently dropped.
const run = found || process.env["CI"] ? describe : describe.skip;

let server: AppServer;

let child: ChildProcess;

let profile = "";


let origin = "";

let next = 0;

let session = "";

let buffer = "";

const waiting = new Map<number, (reply: Reply) => void>();

const send = <T>(method: string, params: Record<string, Json> = {}, sessionId?: string): Promise<T> => {
  const id = ++next;

  return new Promise((resolve, reject) => {
    // SAFETY: the caller names the result type it expects of this DevTools method.
    waiting.set(id, (reply) => (reply.error ? reject(new Error(`${method}: ${reply.error.message}`)) : resolve(reply.result as T)));
    // SAFETY: the child is spawned with a pipe at fd 3.
    (child.stdio[3] as NodeJS.WritableStream).write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
  });
};

/** Runs a constant function declaration in the page with `args` passed as data. */
const call = async <T>(declaration: string, ...args: Json[]): Promise<T> => {
  const { result: page } = await send<{ result: { objectId: string } }>("Runtime.evaluate", { expression: "globalThis" }, session);

  const out = await send<Eval<T>>(
    "Runtime.callFunctionOn",
    { objectId: page.objectId, functionDeclaration: declaration, arguments: args.map((value) => ({ value })), returnByValue: true, awaitPromise: true },
    session,
  );

  if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description ?? out.exceptionDetails.text);

  return out.result.value;
};

const moveTo = (x: number, y: number) => send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" }, session);

/** Resolves when the page function returns truthy: the App's own state is the bound, not a sleep. */
const until = async (predicate: string) => {
  const stop = Date.now() + 15_000;

  while (!(await call<boolean>(predicate))) {
    if (Date.now() > stop) throw new Error(`never became true: ${predicate}`);

    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

beforeAll(async () => {
  if (!found) throw new Error("U112 needs a Chrome binary: set CHROME_PATH");

  server = await appServer();
  origin = (server.resolvedUrls?.local[0] ?? "").replace(/\/$/, "");
  profile = mkdtempSync(join(tmpdir(), "u112-"));
  child = spawn(
    found,
    [...headlessChromeArgs, `--user-data-dir=${profile}`, "about:blank"],
    { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] },
  );
  // SAFETY: the child is spawned with a pipe at fd 4.
  (child.stdio[4] as NodeJS.ReadableStream).on("data", (chunk: Buffer) => {
    buffer += chunk.toString();

    for (let end = buffer.indexOf("\0"); end >= 0; end = buffer.indexOf("\0")) {
      // SAFETY: Chrome writes one JSON message per NUL on its DevTools pipe.
      const reply = JSON.parse(buffer.slice(0, end)) as Reply;

      buffer = buffer.slice(end + 1);

      if (reply.id !== undefined) waiting.get(reply.id)?.(reply);
    }
  });

  const { targetId } = await send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });

  session = (await send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true })).sessionId;
  await send("Page.enable", {}, session);
  await send("Runtime.enable", {}, session);
}, 90_000);

afterAll(async () => {
  if (child) {
    const exited = new Promise((resolve) => child.once("exit", resolve));

    // Browser.close lets Chrome stop its helper processes, which still write to the profile after a SIGKILL of the parent; the kill is the fallback.
    const late = Promise.withResolvers<never>();

    const guard = setTimeout(() => {
      child.kill("SIGKILL");
      late.reject(new Error("Chrome exit after Browser.close timed out"));
    }, 5_000);

    await send("Browser.close").catch(() => child.kill("SIGKILL"));
    await Promise.race([exited, late.promise]).finally(() => clearTimeout(guard));
  }

  await server?.close();


  if (profile) rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

type Metrics = { top: number; height: number; lines: number }[];

/** Page-side: every Shelf row's top edge (in the Shelf's own content, so a scroll of the Shelf is no move), height and the title's line count (distinct line tops of its text). */
const MEASURE = `() => [...document.querySelectorAll(".shelf [data-id]")].map((row) => {
  const title = row.querySelector(".todo-row-button");
  const range = document.createRange();
  range.selectNodeContents(title);
  const box = row.getBoundingClientRect();
  const top = box.top + row.closest(".shelf").scrollTop;
  return { top: Math.round(top * 100) / 100, height: Math.round(box.height * 100) / 100, lines: new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size };
})`;

/** Page-side: the first Shelf row's title grows until one more character would pass its two lines (U359), so it nearly fills the clamp. */
const FILL = `() => {
  const title = document.querySelector(".shelf [data-id] .shelf-title");
  const text = title.firstChild;
  const fits = () => title.scrollHeight <= title.clientHeight + 1;
  let words = "";
  while (fits() && words.length < 2000) { words += "m"; text.textContent = words; }
  text.textContent = words.slice(0, -1);
  return fits();
}`;

const load = async (width: number, height: number) => {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, session);
  await send("Page.navigate", { url: `${origin}/harness.html?seed=tree-40` }, session);
  await until(`() => document.querySelectorAll(".shelf [data-id]").length > 1`);
  expect(await call<boolean>(FILL)).toBe(true);
};

/** The point at the middle of the n-th Shelf row's title. */
const centreOf = (nth: number) =>
  call<{ x: number; y: number }>(
    `(nth) => { const title = document.querySelectorAll(".shelf [data-id] .todo-row-button")[nth]; title.scrollIntoView({ block: "nearest" }); const box = title.getBoundingClientRect(); return { x: box.left + 3, y: box.top + box.height / 2 }; }`,
    nth,
  );

const rowCount = () => call<number>(`() => document.querySelectorAll(".shelf [data-id]").length`);

const rest = () => call<Metrics>(MEASURE);

run("u112 hovering or focusing a Shelf row never moves a row", () => {
  for (const [width, height] of [[1280, 800]] as const) {
    it(`u112_hovering_any_row_changes_no_rows_top_edge_height_or_wrapping_at_${width}x${height}`, async () => {
      await load(width, height);
      const before = await rest();

      for (let nth = 0; nth < (await rowCount()); nth++) {
        const at = await centreOf(nth);

        await moveTo(at.x, at.y);
        await until(`() => Boolean(document.querySelector(".shelf .todo-tick"))`);
        expect(await rest()).toEqual(before);
      }
    }, 60_000);

    it(`u112_focusing_any_row_or_its_tick_box_changes_no_rows_top_edge_height_or_wrapping_at_${width}x${height}`, async () => {
      await load(width, height);
      await moveTo(0, 0);
      const before = await rest();

      for (let nth = 0; nth < (await rowCount()); nth++) {
        await call(`(nth) => document.querySelectorAll(".shelf [data-id] .todo-row-button")[nth].focus()`, nth);
        await until(`() => Boolean(document.querySelector(".shelf .todo-tick"))`);
        expect(await rest()).toEqual(before);
        await call(`() => document.querySelector(".shelf .todo-tick").focus()`);
        expect(await rest()).toEqual(before);
      }
    }, 60_000);
  }
});

/** Page-side: each listed row's top edge from its own section's top edge, and its height, keyed by its text. */
const SECTION_ROWS = `() => Object.fromEntries(["Todos", "pads"].flatMap((label) => {
  const section = document.querySelector('.shelf section[aria-label="' + label + '"]');
  if (!section) return [];
  const base = section.getBoundingClientRect().top;
  return [...section.querySelectorAll("[data-id], [data-shelf-row]")].map((row) => {
    const box = row.getBoundingClientRect();
    return [label + ":" + (row.dataset.id ?? row.querySelector(".pad-name").textContent), { top: Math.round((box.top - base) * 100) / 100, height: Math.round(box.height * 100) / 100 }];
  });
}))`;

/** Rows measured twice 100 ms apart until both reads agree, so a font or scrollbar settling is never read as a row moving. */
const settled = async () => {
  const stop = Date.now() + 10_000;

  for (;;) {
    const first = await call<Record<string, { top: number; height: number }>>(SECTION_ROWS);

    await new Promise((resolve) => setTimeout(resolve, 100));

    const second = await call<Record<string, { top: number; height: number }>>(SECTION_ROWS);

    if (JSON.stringify(first) === JSON.stringify(second)) return second;

    if (Date.now() > stop) throw new Error("the Shelf never stopped moving");
  }
};

run("u347 choosing all under a Workstream moves no row the scope already listed", () => {
  for (const [width, height] of [[1280, 800]] as const) {
    it(`u347_choosing_all_changes_no_listed_rows_height_or_place_in_its_list_at_${width}x${height}`, async () => {
      await load(width, height);
      await call(
        `async () => { const rpc = window.__fake.app.rpc; await rpc("todo.move", { id: 2, home: "backend" }); await rpc("todo.move", { id: 4, home: "backend" }); await rpc("pad.move", { name: "a-pad-with-a-very-long-name-here", home: "backend" }); }`,
      );
      await call(`() => document.querySelector('.rail-row[data-id="backend"]').click()`);
      await until(`() => document.querySelectorAll('.shelf section[aria-label="Todos"] [data-id]').length === 2`);

      const scoped = await settled();

      expect(Object.keys(scoped)).toHaveLength(2);
      await call(`() => document.querySelector('.scope-control[aria-pressed="false"]').click()`);
      await until(`() => document.querySelectorAll('.shelf section[aria-label="Todos"] [data-id]').length > 2`);

      const all = await settled();

      expect(Object.keys(all).length).toBeGreaterThan(2);

      for (const [key, box] of Object.entries(scoped)) expect(all[key]).toEqual(box);

      await call(`() => { localStorage.clear(); }`);
    }, 60_000);
  }
});
