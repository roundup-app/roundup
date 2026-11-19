import { webkit, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { appServer, type AppServer } from "./testing/appServer";

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

    // Only an area the user can reach: its centre hits itself or its own content.
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);

    if (!hit || !element.contains(hit) || box.bottom > innerHeight || box.top < 0) return;

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
  await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
  await page.mouse.wheel(0, 120);
  await page.waitForFunction((index) => (document.querySelector<HTMLElement>(`[data-u7543="${index}"]`)?.scrollTop ?? 0) > 0, mark);
  await page.waitForFunction((selector) => {
    const bar = document.querySelector(selector)?.closest(".os-scrollbar");

    return bar !== null && bar !== undefined && getComputedStyle(bar).visibility === "visible";
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

  // A splitter edge laid over the area's own edge takes the pointer first; that overlap is a splitter fault, not the bar's placement.
  if (wheeled.covered) return;

  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + 12, { steps: 4 });
  await page.mouse.up();

  const dragged = await read();

  expect(dragged.top, `${name}: dragging the thumb down did not scroll down`).toBeGreaterThan(wheeled.top);
};

// U7543a: in every scroll area of each view, the thumb stays on the area's edge, follows the wheel and drags the area.
it("u7543a_every_scroll_area_keeps_its_bar_on_the_edge_and_drags_with_it", async () => {
  const page = await engine.newPage({ viewport: { width: 1512, height: 950 }, colorScheme: "dark" });
  let checked = 0;

  try {
    for (const query of ["seed=tree-40", "view=workstreams&items=1&seed=tree-40", "view=changes&seed=tree-40", "view=notes&seed=agents-10", "view=resources&seed=agents-10"]) {
      await page.goto(new URL(`/harness.html?rest=1&${query}`, server.resolvedUrls.local[0]).href);
      await page.waitForSelector(".rail-row");
      await page.waitForTimeout(300);

      const marks = await overflowing(page);

      for (const [index, name] of marks.entries()) {
        await check(page, index, `${query} ${name}`);
        checked += 1;
      }
    }

    expect(checked, "areas that overflow in the seeded views").toBeGreaterThanOrEqual(3);
  } finally { await page.close(); }
}, 120_000);
