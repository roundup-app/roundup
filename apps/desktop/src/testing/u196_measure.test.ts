import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";

/** U196 in a real Chromium: jsdom has no line boxes, so the measure and the clamp are read from the rendered Thread. */

const found = chromePath();

// A missing browser skips only off CI: on CI the claim must be checked, never silently dropped.
const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U196 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

afterAll(async () => {
  await page?.close();
});

/** Page-side: the Thread's body elements with their rendered width, line count and control, and the width of `120ch` in the body's own font. */
const READ = `() => {
  const probe = document.createElement("div");
  const first = document.querySelector("[data-message-body]");
  probe.style.cssText = "position:absolute;visibility:hidden;width:120ch;font-family:" + getComputedStyle(first).fontFamily + ";font-size:" + getComputedStyle(first).fontSize;
  first.parentElement.append(probe);
  const limit = probe.getBoundingClientRect().width;
  probe.remove();
  return [...document.querySelectorAll("[data-message-body]")].map((body) => {
    const range = document.createRange();
    range.selectNodeContents(body);
    const control = body.nextElementSibling?.querySelector("button");
    return {
      width: body.getBoundingClientRect().width, limit, maxWidth: getComputedStyle(body).maxWidth,
      lines: new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size,
      overflows: body.scrollHeight > body.clientHeight + 1,
      control: control ? { name: control.textContent, expanded: control.getAttribute("aria-expanded") } : null,
    };
  });
}`;

type Row = { width: number; limit: number; maxWidth: string; lines: number; overflows: boolean; control: { name: string; expanded: string } | null };

const load = async (width: number, height: number) => {
  await page.load("/harness.html?seed=long-messages", width, height);
  await page.until(`() => document.querySelectorAll("[data-message-body]").length === 4`);
  // U355: the Messages are in the full log, so the measure is read with it open.
  await page.call(`() => { document.querySelector("[data-log]").open = true; }`);
  await page.until(`() => Boolean(document.querySelector(".thread-more button"))`);
};

const read = () => page.call<Row[]>(READ);

run("u196 the Thread keeps an 120-character measure and the user's Messages clamp at two lines", () => {
  vi.setConfig({ testTimeout: 30_000 });

  for (const [width, height] of [[1280, 800], [700, 800]] as const) {
    it(`u196_a_body_never_exceeds_120ch_at_${width}x${height}`, async () => {
      await load(width, height);

      for (const row of await read()) {
        expect(row.maxWidth).toMatch(/^\d+(\.\d+)?px$|^120ch$/);
        expect(row.width).toBeLessThanOrEqual(row.limit + 1);
      }

      const [long] = await read();

      expect(long!.lines).toBeGreaterThan(1);
    });
  }

  it("u196_a_long_user_message_clamps_at_two_lines_with_read_more", async () => {
    await load(1280, 800);

    const rows = await read();

    expect(rows[0]!.overflows).toBe(true);
    expect(rows[0]!.control).toEqual({ name: "read more", expanded: "false" });
    // U352: an Agent's body that is cut opens too, so the fourth row has the control.
    expect(rows[3]!.control).toEqual({ name: "read more", expanded: "false" });

    const tone = await page.call<{ button: string; sender: string }>(
      `() => ({ button: getComputedStyle(document.querySelector(".thread-more button")).color, sender: getComputedStyle(document.querySelector(".thread-sender")).color })`,
    );

    expect(tone.button).toBe(tone.sender);
  });

  it("u196_a_short_user_message_has_no_read_more", async () => {
    await load(1280, 800);

    const rows = await read();

    expect(rows[1]!.control).toBeNull();
    expect(rows[2]!.control).toBeNull();
  });

  it("u196_read_more_expands_in_place_and_show_less_folds_it", async () => {
    await load(1280, 800);

    const tops = `() => [...document.querySelectorAll("[data-message-sender]")].map((each) => each.getBoundingClientRect().top)`;
    const before = await page.call<number[]>(tops);

    await page.call(`() => document.querySelector(".thread-more button").click()`);

    const open = (await read())[0]!;

    expect(open.control).toEqual({ name: "show less", expanded: "true" });
    expect(open.overflows).toBe(false);
    expect(open.lines).toBeGreaterThan(2);
    expect((await page.call<number[]>(tops))[0]).toBe(before[0]);

    await page.call(`() => document.querySelector(".thread-more button").click()`);
    expect((await read())[0]!.control).toEqual({ name: "read more", expanded: "false" });
  });

  it("u196_the_control_follows_the_line_count", async () => {
    await load(1280, 800);
    await page.resize(280, 800);
    await page.until(`() => document.querySelectorAll(".thread-more button").length === 4`);
    await page.resize(1280, 800);
    await page.until(`() => document.querySelectorAll(".thread-more button").length === 2`);
  });

  /** Page-side: a Message from `you` to the Door arriving by `message.sent`, 400 characters long. */
  const ARRIVE = `(id, status) => window.__fake.emit({
    actor: { kind: "user" }, name: "message.sent",
    data: { id, from: { kind: "user" }, to: "first-workstream", kind: "note", body: "An arriving note that runs long enough to need a third line in the pane once it wraps at the measure. ".repeat(4).slice(0, 400), replyTo: null, status, reason: null, passedFrom: null, at: Date.now() },
  })`;

  it("u196_a_message_arriving_by_event_shows_read_more", async () => {
    await load(1280, 800);
    await page.call(`() => { window.arrive = ${ARRIVE}; }`);
    await page.call(`() => window.arrive(5, "delivered")`);
    await page.until(`() => document.querySelectorAll("[data-message-body]").length === 5`);
    await page.until(`() => document.querySelectorAll(".thread-more button").length === 3`);

    const rows = await read();

    expect(rows[4]!.control).toEqual({ name: "read more", expanded: "false" });
    expect(rows[4]!.overflows).toBe(true);
  });

  it("u196_expanding_one_message_leaves_the_other_clamped", async () => {
    await load(1280, 800);
    await page.call(`() => { window.arrive = ${ARRIVE}; }`);
    await page.call(`() => window.arrive(5, "delivered")`);
    await page.until(`() => document.querySelectorAll(".thread-more button").length === 3`);
    await page.call(`() => document.querySelectorAll(".thread-more button")[0].click()`);

    const rows = await read();

    expect(rows[0]!.control).toEqual({ name: "show less", expanded: "true" });
    expect(rows[4]!.control).toEqual({ name: "read more", expanded: "false" });
    expect(rows[4]!.overflows).toBe(true);
  });

  it("u196_a_status_word_follows_the_control", async () => {
    await load(1280, 800);
    await page.call(`() => { window.arrive = ${ARRIVE}; }`);
    await page.call(`() => window.arrive(5, "pending")`);
    await page.until(`() => document.querySelectorAll("[data-message-status]").length === 1`);

    const order = await page.call<{ word: string; after: boolean; inMore: boolean }>(
      `() => {
        const word = document.querySelector("[data-message-status]");
        const button = word.parentElement.querySelector("button");
        return { word: word.textContent, inMore: word.parentElement.classList.contains("thread-more"), after: Boolean(button && (button.compareDocumentPosition(word) & Node.DOCUMENT_POSITION_FOLLOWING)) };
      }`,
    );

    expect(order).toEqual({ word: "queued", inMore: true, after: true });
  });
});
