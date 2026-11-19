import { webkit, type Browser } from "playwright";
import { afterAll, beforeAll, it } from "vitest";
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

const AREA = "#area";

const THUMB = "#area ~ .scrollbar-slot .os-scrollbar-vertical .os-scrollbar-handle";

// U7543a: a host inside a scrolling ancestor keeps its thumb on its own edge, moves it with the content, and drags the area.
it("u7543a_every_scroll_area_keeps_its_bar_on_the_edge_and_drags_with_it", async () => {
  const page = await engine.newPage({ viewport: { width: 1512, height: 950 } });

  try {
    await page.goto(new URL("/harness.html?rest=1&seed=tree-40", server.resolvedUrls.local[0]).href);
    await page.waitForSelector(".rail-row");
    await page.evaluate(() => {
      document.body.insertAdjacentHTML("beforeend", `<div id="outer" style="position:fixed;inset:0;z-index:5000;background:#222;overflow:auto"><div style="height:1500px"><div id="area" style="margin:100px 0 0 100px;width:300px;height:200px;overflow:auto"><div style="height:1000px">rows</div></div></div></div>`);
    });
    await page.waitForSelector("#area ~ .scrollbar-slot");

    // Scroll the ancestor first: the bar must travel with its area, not with the viewport.
    const drift = await page.evaluate(() => {
      const outer = document.getElementById("outer");
      const slot = document.querySelector("#area ~ .scrollbar-slot");
      const area = document.getElementById("area");

      if (!outer || !slot || !area) throw new Error("the area did not mount");

      outer.scrollTop = 80;

      // Read in the same task as the scroll: a bar placed by script after the scroll still shows its old place here.
      return slot.getBoundingClientRect().top - area.getBoundingClientRect().top;
    });

    if (Math.abs(drift) > 0.5) throw new Error(`the bar's slot sits ${drift} px off its area after the ancestor scrolled`);

    await page.mouse.move(250, 120);
    await page.mouse.wheel(0, 300);
    await page.waitForFunction(() => (document.getElementById("area")?.scrollTop ?? 0) > 0);

    // The library fades the thumb in on scroll and hides it after the idle delay; read it while it shows.
    await page.waitForFunction(() => {
      const bar = document.querySelector("#area ~ .scrollbar-slot .os-scrollbar-vertical");

      return bar !== null && getComputedStyle(bar).visibility === "visible";
    });

    const area = await page.locator(AREA).boundingBox();
    const thumb = page.locator(THUMB);
    const box = await thumb.boundingBox();

    if (!area || !box) throw new Error("no area or thumb box");

    if (box.y < area.y || box.y + box.height > area.y + area.height || box.x < area.x || box.x + box.width > area.x + area.width) {
      throw new Error(`thumb ${JSON.stringify(box)} left its area ${JSON.stringify(area)}`);
    }

    if (box.y <= area.y) throw new Error("thumb did not move down with the content");

    const before = await page.evaluate(() => document.getElementById("area")?.scrollTop ?? 0);

    await thumb.hover({ trial: true });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 20, { steps: 4 });
    await page.mouse.up();
    await page.waitForFunction((from) => (document.getElementById("area")?.scrollTop ?? 0) > from, before);
  } finally { await page.close(); }
}, 60_000);
