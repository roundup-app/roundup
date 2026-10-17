import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { CHECK_IDS } from "../testing/checks";
import type { Checks } from "../testing/checks";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

let page: ChromePage;

beforeAll(async () => {
  const chrome = chromePath();

  if (!chrome) throw new Error("U467 and U468 need isolated headless Chromium: set CHROME_PATH");
  page = await openPage(chrome);
}, 90_000);

afterAll(async () => { await page?.close(); });

const VIEWPORTS = [1280, 1440] as const;

const SCHEMES = ["light", "dark"] as const;

const open = async (width: number, scheme: (typeof SCHEMES)[number]) => {
  await page.scheme(scheme);
  await page.load("/harness.html?seed=tree-40", width, 800);
  await page.until(`() => Boolean(window.__fake && document.querySelector('.rail-row'))`);
};

const select = async (id: string) => {
  await page.call(`(id) => document.querySelector('.rail-row[data-id="' + id + '"]').click()`, id);
  await page.until(`() => Boolean(document.querySelector('.pane-screen'))`);
};

const readChecks = (): Promise<Checks> => page.call<Checks>(`() => window.__checks()`);

const record = async (id: string, name: string, checks: Checks) => {
  const dir = captureDir(id);

  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.png`), Buffer.from(await page.shot(), "base64"));
  writeFileSync(join(dir, `${name}.checks.json`), JSON.stringify(checks, null, 2));
};

const failing = (checks: Checks) => CHECK_IDS.filter((id) => checks[id].status === "fail");

describe("u467 the primary Terminal stands alone", () => {
  it("u467_the_primary_terminal_has_no_thread_wrappers_and_passes_the_checks", async () => {
    for (const width of VIEWPORTS) {
      for (const scheme of SCHEMES) {
        await open(width, scheme);
        await select("payments");

        const wrappers = await page.call<string[]>(`() => [...document.querySelectorAll('.thread-composer, .thread-feed, .thread-header, .digest, [data-thread]')].map((e) => e.className)`);

        expect(wrappers).toEqual([]);

        const checks = await readChecks();

        expect(failing(checks)).toEqual([]);
        await record("U467", `door-${width}-${scheme}`, checks);
      }
    }
  }, 120_000);
});

describe("u468 attention meets the Checks and keeps focus until activated", () => {
  it("u468_attention_meets_checks_and_keeps_focus_until_activated", async () => {
    for (const width of VIEWPORTS) {
      for (const scheme of SCHEMES) {
        await open(width, scheme);
        await select("payments");

        const focused = await page.call<string | null>(`() => document.activeElement?.closest('[data-terminal]')?.dataset.terminal ?? null`);

        await page.call(`() => window.__fake.emit({ actor: { kind: "agent", id: "tokens", parent: null }, name: "agent.status", data: { id: "tokens", attempt: "1", status_revision: "9999", status: { kind: "needs-you", label: "needs you", since: Date.now() } } })`);
        await page.until(`() => document.querySelector('.app-toast')`);

        const after = await page.call<{ selected: string | null; terminal: string | null; toast: string }>(`() => ({
          selected: document.querySelector('[role=treeitem][aria-selected=true]')?.dataset.id ?? null,
          terminal: document.activeElement?.closest('[data-terminal]')?.dataset.terminal ?? null,
          toast: document.querySelector('.app-toast').textContent,
        })`);

        expect(after.selected).toBe("payments");
        expect(after.terminal).toBe(focused);
        expect(after.toast).toContain("token-rotation");

        const checks = await readChecks();

        expect(failing(checks)).toEqual([]);
        await record("U468", `attention-${width}-${scheme}`, checks);

        await page.call(`() => document.querySelector('.app-toast-action').click()`);
        await page.until(`() => document.querySelector('[role=treeitem][aria-selected=true]')?.dataset.id === 'tokens'`);
      }
    }
  }, 120_000);
});
