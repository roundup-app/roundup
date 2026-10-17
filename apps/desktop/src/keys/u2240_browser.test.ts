import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHECK_IDS, type Checks } from "../testing/checks";
import { afterAll, beforeAll, expect, it } from "vitest";
import { appServer, type AppServer } from "../testing/appServer";

const exec = promisify(execFile);

const profile = mkdtempSync(join(tmpdir(), "u2240-"));

const session = `u2240-${process.pid}`;

let server: AppServer;

let origin: string;

const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--json", ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 25_000 })).stdout;

const read = async <T,>(expression: string): Promise<T> => {
  // SAFETY: the envelope is agent-browser's result for the constant expressions below.
  const reply = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

  if (!reply.success) throw new Error(reply.error);

  return reply.data.result;
};

beforeAll(async () => {
  server = await appServer();
  origin = server.resolvedUrls.local[0]!;
  const ready = await fetch(new URL("/__roundup_ready", origin));

  if (!ready.ok) throw new Error(await ready.text());
  await browser("--profile", profile, "open", new URL("/harness.html?seed=tree-40", origin).href);
}, 90_000);

afterAll(async () => {
  try { await browser("close"); } finally { await server?.close(); rmSync(profile, { recursive: true, force: true }); }
});

const wait = async (expression: string) => browser("wait", "--fn", expression);

const FAILURE = "Leader observer rejected send: complete failure remains visible";

it("u2240_the_panel_preserves_rendered_checks", async () => {
  for (const more of [false, true]) {
    if (more) {
      await browser("close");
      await browser("--profile", profile, "--args", "--force-high-contrast,--disable-blink-features=ForcedColors", "open", origin);
    }

    for (const width of [1280, 1440]) for (const scheme of ["light", "dark"]) {
      await browser("set", "viewport", String(width), "800");
      await browser("set", "media", scheme);
      await browser("open", new URL("/harness.html?seed=tree-40", origin).href);
      await wait(`!!window.__fake && !!document.querySelector('.rail-row')`);
      await browser("click", ".rail-row");
      await wait(`!!document.querySelector('.pane-screen')`);
      await read(`(() => {
        window.__fake.failNext(-32003, ${JSON.stringify(FAILURE)});
        document.querySelector('[aria-label="Add Workstream"]').click();
      })()`);
      await wait(`document.querySelector('p.ink[role=alert]')?.textContent.includes(${JSON.stringify(FAILURE)})`);
      expect(await read(`matchMedia("(prefers-contrast: more)").matches`)).toBe(more);

      const before = await read<Checks>(`window.__checks()`);

      await read(`window.__focus = document.activeElement`);
      await browser("press", "Meta+k");
      await wait(`!!document.querySelector('.leader')`);

      const during = await read<Checks>(`window.__checks()`);

      for (const id of CHECK_IDS) if (before[id].status === "pass") expect(during[id].status, `${width} ${scheme} ${more} ${id}`).toBe("pass");

      for (const id of ["D2", "D5", "D6"] as const) expect(during[id].status, `${width} ${scheme} ${id}`).toBe("pass");
      expect(await read(`(() => {
        const panel = document.querySelector('.leader'), box = panel.getBoundingClientRect(), error = document.querySelector('p.ink[role=alert]').getBoundingClientRect();
        const rows = [...document.querySelectorAll('.rail-row')].map(row => row.getBoundingClientRect()).filter(row => row.width > 0 && row.bottom > 0 && row.top < innerHeight);
        const apart = (a, b) => a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom;
        return getComputedStyle(panel).pointerEvents === 'none' && document.activeElement === window.__focus && box.right <= innerWidth && box.bottom <= innerHeight && box.left >= 0
          && new Set([...panel.querySelectorAll('.leader-line')].map(line => Math.round(line.getBoundingClientRect().top))).size === 1
          && panel.scrollWidth <= panel.clientWidth && panel.scrollHeight <= panel.clientHeight && rows.every(row => apart(row, box)) && apart(error, box);
      })()`)).toBe(true);
      await browser("press", "Escape");
      await wait(`!document.querySelector('.leader')`);
      expect(await read(`document.querySelector('p.ink[role=alert]').textContent.includes(${JSON.stringify(FAILURE)})`)).toBe(true);
    }
  }
}, 240_000);
