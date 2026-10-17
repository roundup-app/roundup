import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";

/** Q3 in a real Chromium: jsdom has no layout, so the contrast of the Decision Card and the Drawer is read from the painted page. */

const found = chromePath();

// A missing browser skips only off CI: on CI the claim must be checked, never silently dropped.
const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("Q3 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

afterAll(async () => {
  await page?.close();
});

const load = async (width: number, height: number) => {
  await page.load("/harness.html?seed=door-report", width, height);
  await page.until(`() => Boolean(document.querySelector(".pane-screen"))`);
};

// Q3 contrast needs painted layout, including the selected Rail row.
run("Q3 rendered text contrast", () => {
  vi.setConfig({ testTimeout: 30_000 });

  const checks = async (...surfaces: string[]) => {
    const painted = await page.call<boolean>(`(selectors) => selectors.every((selector) => {
      const element = document.querySelector(selector);
      const box = element?.getBoundingClientRect();
      return box && box.width > 0 && box.height > 0;
    })`, ["[role=treeitem][aria-selected=true] .name", ...surfaces]);

    expect(painted).toBe(true);
    const result = await page.call<Record<string, { status: string }>>(`() => window.__checks()`);

    for (const id of ["D2", "D5"]) expect(result[id], JSON.stringify(result[id])).toMatchObject({ status: "pass" });
  };

  for (const scheme of ["light", "dark"] as const) {
    it(`q3_decision_card_meets_d2_d5_on_painted_layout in ${scheme}`, async () => {
      await page.scheme(scheme);
      await load(1280, 800);
      await page.call(String.raw`() => window.__fake.emit({ actor: { kind: "agent", id: "r1", parent: null }, name: "decision.opened", data: {
        id: "q3-decision", agent: "r1", tool: "ask_user", args: JSON.stringify({ question: "Which folder should I use?", answers: [{ label: "src", description: "about src" }, { label: "docs", description: "about docs" }] }), opened_at: Date.now(), answerable: true
      } })`);
      await page.until(`() => document.querySelector(".decision-question")?.textContent.includes("Which folder")`);
      await checks(".decision-question");
    });

    it(`q3_long_drawer_wraps_and_meets_d2_d5_on_painted_layout in ${scheme}`, async () => {
      await page.scheme(scheme);
      await load(1280, 800);
      await page.call(`async () => {
        const nodes = await window.__fake.app.handlers["rail.tree"]({});
        nodes.find((node) => node.id === "c1").work = { kind: "work", title: "Keep repo unchanged", ask: "Change no file in the repo ".repeat(12).trim(), limits: [] };
        window.__fake.app.handlers["rail.tree"] = () => nodes;
        window.__fake.emit({ actor: { kind: "user", id: "you", parent: null }, name: "rail.changed" });
      }`);
      await page.call(`() => document.querySelector("[data-id='c1'] .name").click()`);
      await page.until(`() => document.querySelector(".order-line")?.textContent.includes("Change no file")`);
      await page.call(`() => document.querySelector(".order-line").click()`);
      await page.until(`() => document.querySelector(".order-ask")?.textContent.length >= 300`);

      const wraps = await page.call<boolean>(`() => {
        const ask = document.querySelector(".order-ask");
        const drawer = document.querySelector("[aria-label='Full order of child']");
        const range = document.createRange();
        range.selectNodeContents(ask);
        return new Set([...range.getClientRects()].map((rect) => rect.top)).size > 1 && ask.scrollWidth <= ask.clientWidth && drawer.scrollWidth <= drawer.clientWidth;
      }`);

      expect(wraps).toBe(true);
      await checks(".order-title", ".order-ask");
    });
  }
});
