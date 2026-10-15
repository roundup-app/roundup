import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openLog, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";

/** U197 in a real Chromium: jsdom has no layout, so the column, the left edge and the line length are read from the rendered Thread. */

const found = chromePath();

// A missing browser skips only off CI: on CI the claim must be checked, never silently dropped.
const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U197 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

afterAll(async () => {
  await page?.close();
});

const ROWS = ".thread-header .thread-goal, .thread-sender, .thread-body, .thread-card-body, .thread-card-answer, .thread-composer textarea";

/** Page-side: the column, each row's first rendered glyph x and widest rendered line, and the width of `120ch` in the row's font. */
const READ = `() => {
  const column = document.querySelector(".thread-column").getBoundingClientRect();
  const rows = [...document.querySelectorAll(${JSON.stringify(ROWS)})].map((row) => {
    const style = getComputedStyle(row);
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;visibility:hidden;width:120ch;font-family:" + style.fontFamily + ";font-size:" + style.fontSize;
    document.body.append(probe);
    const limit = probe.getBoundingClientRect().width;
    probe.remove();
    const range = document.createRange();
    range.selectNodeContents(row);
    const rects = [...range.getClientRects()].filter((rect) => rect.width > 0);
    const box = row.getBoundingClientRect();
    return {
      name: row.className || row.tagName,
      x: row.tagName === "TEXTAREA" ? box.left + parseFloat(style.paddingLeft) : Math.min(...rects.map((rect) => rect.left)),
      widest: row.tagName === "TEXTAREA" ? 0 : Math.max(...rects.map((rect) => rect.width)),
      limit,
      lines: new Set(rects.map((rect) => Math.round(rect.top))).size,
    };
  });
  return { column: { left: column.left, width: column.width, measure: parseFloat(getComputedStyle(document.documentElement).fontSize) * 72 }, rows };
}`;

type Read = { column: { left: number; width: number; measure: number }; rows: { name: string; x: number; widest: number; limit: number; lines: number }[] };

const load = async (width: number, height: number) => {
  await page.load("/harness.html?seed=thread-report", width, height);
  await openLog(page);
  await page.until(`() => document.querySelectorAll("[data-message-body]").length > 0 && Boolean(document.querySelector(".thread-composer textarea"))`);
};

run("u197 the Thread is one page in one column", () => {
  vi.setConfig({ testTimeout: 30_000 });

  for (const [width, height] of [[1280, 800]] as const) {
    it(`u197_every_row_starts_at_one_x_and_no_line_exceeds_the_measure at ${width}x${height}`, async () => {
      await load(width, height);

      const { column, rows } = await page.call<Read>(READ);

      expect(rows.length).toBeGreaterThanOrEqual(7);
      expect(column.width).toBeLessThanOrEqual(column.measure + 1);

      for (const row of rows) {
        expect(Math.abs(row.x - rows[0]!.x), `${row.name} starts at ${row.x}, not ${rows[0]!.x}`).toBeLessThanOrEqual(1);
        expect(row.widest, row.name).toBeLessThanOrEqual(row.limit + 1);
      }

      // U422: the goal is one line, cut at the column's edge.
      expect(rows.find((row) => row.name.includes("thread-goal"))!.lines).toBe(1);
    });

    it(`u197_d11_reads_pass_on_the_rendered_thread at ${width}x${height}`, async () => {
      await load(width, height);

      const d11 = await page.call<{ status: string }>(`() => window.__checks().D11`);

      expect(d11, JSON.stringify(d11)).toMatchObject({ status: "pass" });
    });
  }

  it("u197_the_takeover_header_sits_above_the_terminal_pane", async () => {
    await load(1280, 800);
    await page.call(`async () => { document.querySelector("[aria-label='More']").click(); await new Promise((done) => setTimeout(done, 50)); [...document.querySelectorAll("[role=menuitem]")].find((item) => item.textContent === "Take control").click(); }`);
    await page.until(`() => /Control: Typing goes straight to/.test(document.body.textContent)`);

    const above = await page.call<boolean>(`() => {
      const header = document.querySelector("[data-thread-header]").getBoundingClientRect();
      const terminal = document.querySelector(".pane-screen");
      return Boolean(terminal) && header.bottom <= terminal.getBoundingClientRect().top + 1;
    }`);

    expect(above).toBe(true);
  });
});

// Q3 and U197 contrast needs painted layout, including the selected Rail row.
run("Q3 and U197 rendered text contrast", () => {
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
    it(`u197_user_and_supervisor_messages_meet_d5_on_painted_layout in ${scheme}`, async () => {
      await page.scheme(scheme);
      await load(1280, 800);
      await page.until(`() => document.querySelector(".thread-run[data-user] .thread-body") && document.querySelector(".thread-run:not([data-user]) .thread-body")`);
      await checks(".thread-run[data-user] .thread-body", ".thread-run:not([data-user]) .thread-body");
    });

    it(`q3_thread_text_meets_d2_d5_on_painted_layout in ${scheme}`, async () => {
      await page.scheme(scheme);
      await load(1280, 800);
      await page.call(String.raw`() => window.__fake.emit({ actor: { kind: "agent", id: "r1", parent: null }, name: "message.sent", data: {
        id: 50, from: { kind: "agent", id: "r1", parent: null }, to: "you", kind: "note",
        body: "Run \`just check\` first.\n\`\`\`\ncargo test\n\`\`\`\n| Agent | State |\n| --- | --- |\n| alpha | editing |\n| beta | idle |\n| gamma | done |\nNext: wait.",
        replyTo: null, status: "delivered", reason: null, passedFrom: null, at: Date.now()
      } })`);
      await page.until(`() => document.querySelector("[data-message-body] table tbody").children.length === 3 && document.querySelector("[data-message-body] pre")`);
      await checks("[data-message-body] table", "[data-message-body] pre", "[data-message-body] p code");
    });

    it(`q3_decision_card_meets_d2_d5_on_painted_layout in ${scheme}`, async () => {
      await page.scheme(scheme);
      await load(1280, 800);
      await page.call(String.raw`() => window.__fake.emit({ actor: { kind: "agent", id: "r1", parent: null }, name: "decision.opened", data: {
        id: "q3-decision", agent: "r1", tool: "ask_user", args: JSON.stringify({ question: "Which folder should I use?", answers: [{ label: "src", description: "about src" }, { label: "docs", description: "about docs" }] }), opened_at: Date.now(), answerable: true
      } })`);
      await page.until(`() => document.querySelector(".decision-question")?.textContent.includes("Which folder")`);
      await checks(".decision-question");
    });

    it(`q3_digest_card_meets_d2_d5_on_painted_layout in ${scheme}`, async () => {
      await page.scheme(scheme);
      await load(1280, 800);
      // Render the digest body through the seeded Agent; q2_digest_in_the_thread proves Daemon-to-Door delivery.
      await page.call(String.raw`() => window.__fake.emit({ actor: { kind: "agent", id: "r1", parent: null }, name: "message.sent", data: {
        id: 51, from: { kind: "agent", id: "r1", parent: null }, to: "you", kind: "note",
        body: "[digest] alpha is idle\n  last: " + "Change no file in the repo ".repeat(12).trim() + "\n  open todos: 3\n  pads: notes, plan",
        replyTo: null, status: "delivered", reason: null, passedFrom: null, at: Date.now()
      } })`);
      await page.until(`() => document.querySelector(".digest-card")?.textContent.includes("notes")`);
      await checks(".digest-card");
    });

    it(`q3_long_drawer_wraps_and_meets_d2_d5_on_painted_layout in ${scheme}`, async () => {
      await page.scheme(scheme);
      await load(1280, 800);
      await page.call(`async () => {
        const nodes = await window.__fake.app.handlers["rail.tree"]({});
        nodes.find((node) => node.id === "r1").work = { kind: "work", title: "Keep repo unchanged", ask: "Change no file in the repo ".repeat(12).trim(), limits: [] };
        window.__fake.app.handlers["rail.tree"] = () => nodes;
        window.__fake.emit({ actor: { kind: "user", id: "you", parent: null }, name: "rail.changed" });
      }`);
      await page.until(`() => document.querySelector(".thread-goal")?.textContent.includes("Change no file")`);
      await page.call(`() => document.querySelector("[aria-label='Order of workstream-1']").click()`);
      await page.until(`() => document.querySelector(".order-ask")?.textContent.length >= 300`);

      const wraps = await page.call<boolean>(`() => {
        const ask = document.querySelector(".order-ask");
        const drawer = document.querySelector("[aria-label='Full order of workstream-1']");
        const range = document.createRange();
        range.selectNodeContents(ask);
        return new Set([...range.getClientRects()].map((rect) => rect.top)).size > 1 && ask.scrollWidth <= ask.clientWidth && drawer.scrollWidth <= drawer.clientWidth;
      }`);

      expect(wraps).toBe(true);
      await checks(".order-title", ".order-ask");
    });
  }
});
