import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";

import { CHECK_IDS } from "../testing/checks";
import type { Checks } from "../testing/checks";
import { captureDir } from "../testing/captures";

const exec = promisify(execFile);

const profile = mkdtempSync(join(tmpdir(), "u485-"));

const session = `u485-${process.pid}`;

const art = captureDir("U485");

let server: ViteDevServer;

let origin: string;

const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--json", ...args], { env: { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: "15000" }, maxBuffer: 8 * 1024 * 1024, timeout: 25_000 })).stdout;

const read = async <T,>(expression: string): Promise<T> => {
  // SAFETY: the envelope is agent-browser's result for the constant expressions below.
  const reply = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

  if (!reply.success) throw new Error(reply.error);

  return reply.data.result;
};

beforeAll(async () => {
  server = await createServer({ cacheDir: join(profile, "vite"), server: { port: 0, hmr: false }, logLevel: "silent" });
  await server.listen();
  origin = server.resolvedUrls!.local[0]!;
  await browser("--profile", profile, "open", new URL(new URL("./u485Fixture.tsx", import.meta.url).pathname.replace("Fixture.tsx", ".html"), origin).href);

  if (art) mkdirSync(art, { recursive: true });
}, 90_000);

afterAll(async () => {
  try { await browser("close"); } finally { await server?.close(); rmSync(profile, { recursive: true, force: true }); }
});

const baseline = process.env.ROUNDUP_CAPTURE_BASE === "1";

it("u485_rendered_checks", async () => {
  const initial = Array.from({ length: 40 }, (_, index) => String(index + 1)).join(",");
  const reordered = ["2", "1", ...Array.from({ length: 38 }, (_, index) => String(index + 3))].join(",");
  const preview = `[...document.querySelectorAll('.u485-fixture > .u485-row:not([data-dnd-placeholder])')].map(el => el.dataset.id).join(',')`;

  for (const width of [1280, 1440]) for (const scheme of ["light", "dark"]) for (const input of ["keyboard", "pointer"]) {
    await browser("set", "viewport", String(width), "800");
    await browser("set", "media", scheme);
    await browser("open", new URL(new URL("./u485Fixture.tsx", import.meta.url).pathname.replace("Fixture.tsx", ".html"), origin).href);
    await browser("wait", "--fn", `document.querySelectorAll('.u485-row').length === 40`);

    const capture = async (step: string) => {
      const checks = await read<Checks>(`import('/src/testing/checks.ts').then(module => module.runChecks(document))`);

      if (art) {
        const dir = join(art, baseline ? "base" : "head");
        mkdirSync(dir, { recursive: true });
        const name = `${input}-${step}-${width}-${scheme}`;
        await browser("screenshot", join(dir, `${name}.png`));
        writeFileSync(join(dir, `${name}.checks.json`), JSON.stringify(checks, null, 2));
      }

      if (!baseline) for (const id of CHECK_IDS) expect(checks[id], `${input} ${step} ${width} ${scheme} ${id}`).toMatchObject({ status: "pass" });
    };

    const move = async () => {
      await browser("focus", '[aria-label="Move 1"]');

      if (input === "keyboard") {
        await browser("press", "Space");
        await browser("wait", "--fn", `!!document.querySelector('[data-dnd-dragging]')`);
        await browser("press", "ArrowDown");
      } else {
        const points = await read<{ x: number; y: number }[]>(`['1','2'].map(id => { const r = document.querySelector('[aria-label="Move '+id+'"]').getBoundingClientRect(); return { x: r.x+r.width/2, y: r.y+r.height/2 }; })`);
        const [start, end] = points;

        if (!start || !end) throw new Error("Missing handles");
        await browser("mouse", "move", String(Math.round(start.x)), String(Math.round(start.y)));
        await browser("mouse", "down");
        await browser("mouse", "move", String(Math.round(start.x + 15)), String(Math.round(start.y)));
        await browser("wait", "--fn", `!!document.querySelector('[data-dnd-dragging]')`);
        await browser("mouse", "move", String(Math.round(end.x)), String(Math.round(end.y)));
      }

      await browser("wait", "--fn", `${preview} === '${reordered}'`);
    };

    await capture("idle");
    await move();
    await capture("held-cancel");
    await browser("press", "Escape");

    if (input === "pointer") await browser("mouse", "up");
    await browser("wait", "--fn", `!document.querySelector('[data-dnd-dragging]') && ${preview} === '${initial}'`);
    expect(await read<string>(`document.querySelector('[aria-label="Committed order"]').textContent`)).toBe(initial);
    expect(await read<string>(`document.querySelector('[aria-label=Commits]').textContent`)).toBe("0");
    await capture("cancelled");
    await move();
    await capture("held-drop");
    await browser(...(input === "keyboard" ? ["press", "Space"] : ["mouse", "up"]));
    await browser("wait", "--fn", `!document.querySelector('[data-dnd-dragging]') && document.querySelector('[aria-label=Commits]').textContent === '1'`);
    expect(await read<string>(`document.querySelector('[aria-label="Committed order"]').textContent`)).toBe(reordered);
    expect(await read<string>(preview)).toBe(reordered);
    await capture("dropped");
  }
}, 360_000);
