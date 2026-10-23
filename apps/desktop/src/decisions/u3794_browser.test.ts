import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import type { Checks } from "../testing/checks";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

let page: ChromePage;

beforeAll(async () => {
  const chrome = chromePath();

  if (!chrome) throw new Error("U3794 needs isolated headless Chromium: set CHROME_PATH");
  page = await openPage(chrome);
}, 90_000);

afterAll(async () => { await page?.close(); });

const record = async (id: string, name: string) => {
  const dir = captureDir(id);

  if (!dir) return;

  const checks = await page.call<Checks>(`() => window.__checks()`);

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.png`), Buffer.from(await page.shot(), "base64"));
  writeFileSync(join(dir, `${name}.checks.json`), JSON.stringify(checks, null, 2));
};

const select = async (agent: string) => {
  await page.call(`(id) => document.querySelector('.rail-row[data-id="' + id + '"]').click()`, agent);
  await page.until(`() => Boolean(document.querySelector('.decision-card'))`);
};

it("u3794_the_card_and_each_folded_line_render_in_dark_at_1280", async () => {
  await page.scheme("dark");
  await page.load("/harness.html?seed=decisions", 1280, 800);
  await page.until(`() => Boolean(window.__fake && document.querySelector('.rail-row'))`);

  await select("agent-1");
  expect(await page.call<string>(`() => document.querySelector('.decision-card .decision-tag').textContent`)).toBe("Destructive");
  await record("U3794", "bash-destructive");

  await select("agent-4");
  expect(await page.call<string>(`() => document.querySelector('.decision-effects').textContent`)).toContain("+2 −1");
  await record("U3794", "edit");

  await page.call(`() => document.querySelector('.decision-card .app-segment:last-child input').click()`);
  await page.call(`() => [...document.querySelectorAll('.decision-card button')].find((b) => b.textContent === 'Allow').click()`);
  await page.until(`() => Boolean(document.querySelector('.decision-fold'))`);
  await page.until(`() => document.querySelector('.decision-fold').getAnimations().length === 0`);
  expect(await page.call<string>(`() => document.querySelector('.decision-fold').textContent`)).toContain("Allowed for this Project");
  await record("U3795", "allowed-project");
}, 120_000);
