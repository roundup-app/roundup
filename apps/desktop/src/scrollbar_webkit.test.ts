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

/** Every drawn scroll area that overflows in the current view, by the library's own host marker. */
const overflowing = (page: Page) => page.evaluate(() => {
  const marks: string[] = [];

  document.querySelectorAll<HTMLElement>("*").forEach((element) => {
    const slot = element.nextElementSibling;

    if (!(slot instanceof HTMLElement) || !slot.classList.contains("scrollbar-slot") || slot.hidden) return;

    if (element.clientHeight < 60 || element.checkVisibility() === false) return;

    // A seeded view rarely overflows every area; give each one scrolling room so the same clauses read on all of them.
    if (element.scrollHeight - element.clientHeight < 40) element.insertAdjacentHTML("beforeend", `<div aria-hidden="true" style="height:${element.clientHeight * 3}px;flex:none"></div>`);

    // The library lets an area scroll only after it measures the room; an overflow:hidden area is scrolled by code, never by the wheel or a drag.
    if (!/auto|scroll/.test(getComputedStyle(element).overflowY)) return;

    // Only an area the user can reach: its centre hits itself or its own content.
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);

    if (!hit || !element.contains(hit) || box.bottom > innerHeight || box.top < 0) return;

    // The wheel scrolls the innermost scroller under the pointer, so an area whose centre sits in a scrolling child is that child's to prove.
    let inner: Element | null = hit;

    while (inner && inner !== element && !(/auto|scroll/.test(getComputedStyle(inner).overflowY) && inner.scrollHeight > inner.clientHeight)) inner = inner.parentElement;

    if (inner !== element) return;

    // A host nested inside also took filler, and which of the two takes the wheel then depends on the engine: the inner one is proved by its own pass.
    if ([...element.querySelectorAll(".scrollbar-slot")].some((slot) => slot.previousElementSibling instanceof HTMLElement && slot.previousElementSibling.clientHeight >= 60 && slot.previousElementSibling.checkVisibility())) return;

    element.setAttribute("data-u7543", String(marks.length));
    marks.push(element.className || element.tagName);
  });

  return marks;
});

const thumbOf = (mark: number) => `[data-u7543="${mark}"] ~ .scrollbar-slot .os-scrollbar-vertical .os-scrollbar-handle`;

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

/** U7543a's areas the seeded scenes must each reach: a missing one fails, so a skipped area cannot pass. The Rail hides its own bar (U3530b), so it has none to prove. */
const REQUIRED = ["shelf-area", "todo-detail", "pad-editor", "settings-content", "changes-body"];

const longText = Array.from({ length: 60 }, (_, line) => `Line ${line} of a document that overflows its area.`).join("\n\n");

/** Each scene is a seeded harness page and the steps that open the views U7543a names, so their hosts hold overflowing content. */
const SCENES: { query: string; open?: (page: Page) => Promise<void> }[] = [
  { query: "/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40" },
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
  },
  {
    query: "/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40",
    open: async (page) => {
      await page.evaluate(() => window.dispatchEvent(new Event("open-app-settings")));
      await page.waitForSelector(".settings-view");
    },
  },
  {
    query: "/src/changes/u2540.html?dense",
    open: async (page) => {
      // The page answers the diff reads only; the Rail's icon needs the owned-changes read, so give it one and nudge the Agent's status to refresh it.
      await page.evaluate(() => {
        window.__fake.app.handlers["agent.ownedChanges"] = () => ({ groups: [{ repo: "/p", branch: "main", base: "main", files: [{ path: "a.ts", status: "modified", line: 1 }] }] });
        window.__fake.setStatus("agent-1", "idle", "idle");
      });
      await page.click(".changes-icon");
      await page.waitForSelector(".changes-files li");
      // This page mounts the App without main.tsx, so start the scrollbars it would have started.
      await page.evaluate('import("/src/scrollHover.ts").then((scrollHover) => scrollHover.trackScrollbars(document))');
    },
  },
];

// U7543a: in every scroll area of each scene, the thumb stays on the area's edge, follows the wheel and drags the area.
it("u7543a_every_scroll_area_keeps_its_bar_on_the_edge_and_drags_with_it", async () => {
  const page = await engine.newPage({ viewport: { width: 1512, height: 950 }, colorScheme: "dark" });
  const reached = new Set<string>();

  try {
    for (const [scene, { query, open }] of SCENES.entries()) {
      await page.goto(new URL(query, server.resolvedUrls.local[0]).href);
      await page.waitForSelector(".rail-row");
      await page.waitForTimeout(1000);
      await open?.(page);
      await page.waitForTimeout(1000);

      // The first pass gives every area its room; the library measures it, and the second reads which areas then scroll.
      await overflowing(page);
      await page.waitForTimeout(500);

      const marks = await overflowing(page);

      console.log("MARKS", scene, JSON.stringify(marks));

      for (const [index, name] of marks.entries()) {
        await check(page, index, `scene ${scene} ${name}`);

        for (const token of name.split(/\s+/)) reached.add(token);
      }
    }

    expect(REQUIRED.filter((area) => !reached.has(area)), "U7543a areas the test never reached").toEqual([]);
  } finally { await page.close(); }
}, 180_000);
