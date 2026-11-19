import { webkit, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { appServer, type AppServer } from "./testing/appServer";

/* U7543a explicitly commissions these geometry and scroll-offset guards for every scroll area. */
/* oxlint-disable anti-slop/no-new-web-assertions */
let server: AppServer;

let engine: Browser;

beforeAll(async () => {
  server = await appServer();
  engine = await webkit.launch();
}, 90_000);

afterAll(async () => {
  await engine?.close();
  await server?.close();
});

/** Marks a named area and the one bar slot beside it, and gives the area scrolling room when its seeded content fits. */
const prepare = (page: Page, selector: string, mark: number) => page.evaluate(({ selector, mark }) => {
  const area = document.querySelector<HTMLElement>(selector);
  const [slot, ...others] = [...(area?.parentElement?.children ?? [])].filter((child) => child.classList.contains("scrollbar-slot"));

  // Each named area is the only scroll host among its siblings, so the one slot beside it holds its bars.
  if (!area || !slot || others.length > 0) return false;

  area.setAttribute("data-u7543", String(mark));
  slot.setAttribute("data-u7543-slot", String(mark));

  // A seeded view rarely overflows every area; give this one scrolling room so the same clauses read on all of them.
  if (area.scrollHeight - area.clientHeight < 40) area.insertAdjacentHTML("beforeend", `<div aria-hidden="true" style="height:${area.clientHeight * 3}px;flex:none"></div>`);

  return true;
}, { selector, mark });

/** What a failure message needs to tell an engine miss from a test miss: the area's overflow and its slot. */
const state = (page: Page, selector: string) => page.evaluate((selector) => {
  const area = document.querySelector<HTMLElement>(selector);

  if (!area) return "not drawn";

  const slots = [...(area.parentElement?.children ?? [])].filter((child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains("scrollbar-slot"));

  return `overflowY ${getComputedStyle(area).overflowY}, scroll ${area.scrollHeight}/${area.clientHeight}, slots ${slots.map((slot) => `hidden=${slot.hidden} ${slot.getAttribute("style")}`).join(" | ") || "none"}`;
}, selector);

const thumbOf = (mark: number) => `[data-u7543-slot="${mark}"] .os-scrollbar-vertical .os-scrollbar-handle`;

/** U7543a for one area: wheel it, read the thumb while it shows, then drag it. */
const check = async (page: Page, mark: number, name: string) => {
  const area = page.locator(`[data-u7543="${mark}"]`);
  const frame = await area.boundingBox();

  if (!frame) throw new Error(`${name}: no box`);

  await area.evaluate((element) => { element.scrollTop = 0; });
  // A reloaded page keeps the pointer where the last view left it: enter the area from its corner so the wheel has a target.
  await page.mouse.move(frame.x + 2, frame.y + 2);
  await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2, { steps: 3 });
  await expect.poll(async () => {
    await page.mouse.wheel(0, 120);

    return area.evaluate((element) => element.scrollTop);
  }, { message: `${name}: the wheel did not scroll the area`, timeout: 10_000, interval: 200 }).toBeGreaterThan(0);
  await page.waitForFunction((selector) => {
    const handle = document.querySelector(selector);
    const bar = handle?.closest(".os-scrollbar");

    // The track and thumb each run their own visibility transition after the bar's, so the thumb takes the pointer only once all three show.
    return bar !== null && bar !== undefined && getComputedStyle(bar).opacity === "1" && getComputedStyle(handle ?? bar).visibility === "visible";
  }, thumbOf(mark));

  const read = () => area.evaluate((element, selector) => {
    const handle = document.querySelector(selector)?.getBoundingClientRect();
    const box = element.getBoundingClientRect();

    const covered = handle ? document.elementFromPoint(handle.x + handle.width / 2, handle.y + handle.height / 2)?.closest(".resize-edge") != null : false;

    return { covered, top: element.scrollTop, range: element.scrollHeight - element.clientHeight, handle: handle ? { y: handle.y, height: handle.height, x: handle.x, width: handle.width } : null, box: { y: box.y, height: box.height, x: box.x, width: box.width } };
  }, thumbOf(mark));

  const wheeled = await read();

  if (!wheeled.handle) throw new Error(`${name}: no thumb`);

  const { handle, box } = wheeled;

  expect(handle.y, `${name}: thumb above its area`).toBeGreaterThanOrEqual(box.y - 1);
  expect(handle.y + handle.height, `${name}: thumb below its area`).toBeLessThanOrEqual(box.y + box.height + 1);
  expect(handle.x + handle.width, `${name}: thumb left of its area`).toBeGreaterThan(box.x);
  expect(handle.x, `${name}: thumb right of its area`).toBeLessThan(box.x + box.width);

  // Offset along the track is scrollTop / range, of the room the thumb has.
  const room = box.height - handle.height;
  const expected = (wheeled.top / wheeled.range) * room;

  expect(Math.abs(handle.y - box.y - expected), `${name}: thumb offset ${handle.y - box.y} against ${expected}`).toBeLessThan(Math.max(3, room * 0.08));

  // A thumb under another element cannot be dragged: that is the owner's "unusable" report, so it fails.
  expect(wheeled.covered, `${name}: a splitter edge covers the thumb`).toBe(false);

  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + 12, { steps: 4 });
  await page.mouse.up();

  const dragged = await read();

  expect(dragged.top, `${name}: dragging the thumb down did not scroll down`).toBeGreaterThan(wheeled.top);
};

const longText = Array.from({ length: 60 }, (_, line) => `Line ${line} of a document that overflows its area.`).join("\n\n");

/** Each scene is a seeded harness page, the steps that open the views U7543a names, and the scroll areas it must prove: a missing one fails, so a skipped area cannot pass. The Rail hides its own bar (U3530b), so it has none to prove. */
const SCENES: { query: string; open?: (page: Page) => Promise<void>; areas: string[] }[] = [
  { query: "/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40", areas: [".ask-bar", ".shelf-area"] },
  {
    query: "/harness.html?seed=tree-40",
    open: async (page) => {
      await page.evaluate(async (body) => {
        const app = window.__fake.app;
        await app.rpc("todo.update", { id: 1, title: "Scrollbar todo", body });
        await app.rpc("todo.assign", { id: 1, owner: null });
        const tab = document.querySelector<HTMLElement>("#shelf-tab-todos");

        if (tab?.getAttribute("aria-expanded") !== "true") tab?.click();
      }, longText);
      await page.waitForSelector("[data-shelf-group=unassigned]");
      await page.evaluate(() => {
        const group = document.querySelector<HTMLElement>("[data-shelf-group=unassigned] .shelf-group-control");

        if (group?.getAttribute("aria-expanded") === "false") group.click();
      });
      await page.waitForSelector('[data-todo="1"] .todo-row-button');
      await page.focus('[data-todo="1"] .todo-row-button');
      await page.keyboard.press("Enter");
      await page.waitForSelector(".todo-detail-title");
    },
    areas: [".todo-detail"],
  },
  {
    query: "/harness.html?seed=tree-40",
    open: async (page) => {
      await page.evaluate((body) => window.__fake.app.rpc("pad.write", { name: "pad-3", text: body }), longText);
      await page.click("#shelf-tab-pads");
      await page.focus('.pads-tab [data-pad="pad-3"] .pad-name');
      await page.keyboard.press("Enter");
      await page.waitForSelector(".pad-editor");
    },
    areas: [".pad-editor", ".shelf-area"],
  },
  {
    query: "/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40",
    open: async (page) => {
      await page.evaluate(() => window.dispatchEvent(new Event("open-app-settings")));
      await page.waitForSelector(".settings-view");
    },
    areas: [".settings-content"],
  },
  {
    // The plain page: `?dense` gives the row a 10,000-line rewrite to count on the main thread, which outlasts the click's 30 s wait in WebKit; `prepare` adds the overflow.
    query: "/src/changes/u2540.html",
    open: async (page) => {
      // The page answers the diff reads only; the Rail's icon needs the owned-changes read, so give it one and nudge the Agent's status to refresh it.
      await page.evaluate(() => {
        window.__fake.app.handlers["agent.ownedChanges"] = () => ({ groups: [{ repo: "/p", branch: "main", base: "main", files: [{ path: "a.ts", status: "modified", line: 1, counts: null }] }] });
        window.__fake.setStatus("agent-1", "idle", "idle");
      });
      await page.click(".changes-icon");
      await page.waitForSelector(".changes-files li");
      // This page mounts the App without main.tsx, so load the sheets and start the scrollbars it would have.
      await page.evaluate('Promise.all([import("/src/sheets.ts"), import("/src/scrollHover.ts")]).then(([, scrollHover]) => scrollHover.trackScrollbars(document))');
    },
    areas: [".changes-body"],
  },
];

// U7543a: in every named scroll area of each scene, the thumb stays on the area's edge, follows the wheel and drags the area.
it("u7543a_every_scroll_area_keeps_its_bar_on_the_edge_and_drags_with_it", async () => {
  const page = await engine.newPage({ viewport: { width: 1512, height: 950 }, colorScheme: "dark" });
  const failures: string[] = [];
  let count = 0;

  try {
    for (const [scene, { query, open, areas }] of SCENES.entries()) {
      await page.goto(new URL(query, server.resolvedUrls.local[0]).href);
      await page.waitForSelector(".rail-row");
      await page.waitForTimeout(1000);
      await open?.(page);

      // Every area is checked and its failure kept, so one run names every area whose bar fails.
      for (const selector of areas) {
        const name = `scene ${scene} ${selector}`;

        count += 1;
        const mark = count;

        try {
          await expect.poll(() => prepare(page, selector, mark), { message: `${name}: drawn with one bar slot beside it`, timeout: 10_000, interval: 200 }).toBe(true);
          // The library lets an area scroll only after it measures the room; an overflow:hidden area is scrolled by code, never by the wheel or a drag.
          await page.waitForFunction((selector) => {
            const area = document.querySelector<HTMLElement>(selector);

            return area !== null && /auto|scroll/.test(getComputedStyle(area).overflowY) && area.scrollHeight - area.clientHeight >= 40;
          }, selector, { timeout: 10_000 });
          await check(page, mark, name);
        } catch (error) {
          failures.push(`${name}: ${String(error instanceof Error ? error.message : error).split("\n")[0]} (${await state(page, selector)})`);
        }
      }
    }

    expect(failures, "U7543a areas whose bar failed").toEqual([]);
  } finally { await page.close(); }
}, 180_000);
