import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";

import { appServer, type AppServer } from "../testing/appServer";

const exec = promisify(execFile);

const profile = mkdtempSync(join(tmpdir(), "rail-browser-"));

const session = `rail-${process.pid}`;

let server: AppServer;

let origin: string;

const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--json", ...args], { maxBuffer: 8 * 1024 * 1024 })).stdout;

const read = async <T,>(expression: string): Promise<T> => {
  // SAFETY: agent-browser's JSON envelope carries the result of the constant page expression below.
  const reply = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error: string | null };

  if (!reply.success) throw new Error(reply.error ?? "browser evaluation failed");

  return reply.data.result;
};

const load = async (seed = "tree-40", scheme = "light") => {
  await browser("set", "media", scheme);
  await browser("set", "viewport", "1280", "800");
  await browser("open", `${origin}/harness.html?seed=${seed}`);
  await browser("wait", "--fn", "Boolean(window.__fake) && document.querySelectorAll('.rail-row').length > 2");
};

beforeAll(async () => {
  server = await appServer();
  origin = server.resolvedUrls.local[0]!;
  await browser("--profile", profile, "open", origin);
}, 90_000);

afterAll(async () => {
  try {
    await browser("close");
  } finally {
    await server?.close();
    rmSync(profile, { recursive: true, force: true });
  }
});

it("u446_only_working_turns", async () => {
  await load();
  const kinds = await read<string[]>(`[...document.querySelectorAll('.glyph')].filter(g => g.getAnimations({subtree:true}).length).map(g => g.dataset.drawing)`);
  expect(kinds.length).toBeGreaterThan(0);
  expect(new Set(kinds)).toEqual(new Set(["quarter"]));

  const timing = await read<{ duration: number; easing: string; properties: string[] }>(`(() => {
    const a = document.querySelector('.working-arc').getAnimations()[0];
    return { duration: a.effect.getTiming().duration, easing: a.effect.getTiming().easing,
      properties: Object.keys(a.effect.getKeyframes()[1]).filter(k => !['offset','computedOffset','easing','composite'].includes(k)) };
  })()`);

  expect(timing.duration).toBeGreaterThanOrEqual(900);
  expect(timing.duration).toBeLessThanOrEqual(1100);
  expect(timing.easing).toBe("linear");
  expect(timing.properties).toEqual(["transform"]);
}, 60_000);

it("u446_reduced_motion_stills_the_arc", async () => {
  await load();
  await browser("set", "media", "light", "reduced-motion");
  expect(await read<number>(`document.querySelector('.working-arc').getAnimations().length`)).toBe(0);
}, 60_000);

it("u447_the_head_is_inert", async () => {
  await load();
  expect(await read<boolean>(`document.querySelector('.section-head').querySelector('button,[tabindex]') === null`)).toBe(true);
}, 60_000);

it("u448_dense_failure_is_visible_at_supported_viewports", async () => {
  await load("tree-40");
  await read(`(() => { window.__fake.failNext(-32003, 'name already taken'); document.querySelector('.rail button[aria-label="Add Workstream"]').click(); })()`);
  await browser("wait", "--text", "name already taken");
  expect(await read<string>(`document.querySelector('.rail [role="alert"]').textContent`)).toContain("name already taken");
}, 60_000);
