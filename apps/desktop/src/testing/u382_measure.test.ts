import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";

/** U382's observer: a real Chromium on `tabs-8`; the visible text of each clipped tab name is the characters whose boxes lie inside the name button's content box, plus the `…`. */

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U382 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

afterAll(async () => {
  await page?.close();
});

type Read = { name: string; visible: string; width: number };

const READ = `() => [...document.querySelectorAll(".tab-name-button")].map((button) => {
  const box = button.getBoundingClientRect();
  const style = getComputedStyle(button);
  const left = box.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
  const right = box.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
  const head = button.querySelector(".tab-head");
  const clipped = head.scrollWidth > head.clientWidth + 0.5;
  // The ellipsis covers the end of the head's box, so a character there is not drawn.
  const dots = document.createElement("span");
  dots.style.cssText = "position:absolute;white-space:pre;font:" + getComputedStyle(head).font;
  dots.textContent = "…";
  head.append(dots);
  const ellipsis = dots.getBoundingClientRect().width;
  dots.remove();
  const headRight = head.getBoundingClientRect().right - (clipped ? ellipsis : 0);
  let visible = "";
  let name = "";
  for (const part of [head, button.querySelector(".tab-tail")]) {
    const walker = document.createTreeWalker(part, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const { segment, index } of new Intl.Segmenter().segment(node.data)) {
        const one = document.createRange();
        one.setStart(node, index);
        one.setEnd(node, index + segment.length);
        const rect = one.getClientRects()[0];
        name += segment;
        if (rect && rect.left >= left - 0.5 && rect.right <= right + 0.5 && (part !== head || rect.right <= headRight + 0.5)) visible += segment;
      }
    }
    if (part === head && clipped) visible += "…";
  }
  return { name, visible, width: box.width };
})`;

const open = async (width: number) => {
  await page.load("/harness.html?seed=tabs-8", width, 800);
  await page.until(`() => document.querySelectorAll(".tab-name-button").length === 8`);
  await page.until(`() => { const left = document.querySelector(".tab-name-button").getBoundingClientRect().left; const same = window.__last === left; window.__last = left; return same; }`);

  return page.call<Read[]>(READ);
};

run("u382 a clipped tab keeps what tells it apart", () => {
  vi.setConfig({ testTimeout: 30_000 });

  it("u382_clipped_twins_differ_on_tabs_8", async () => {
    const tabs = (await open(1280)).filter((each) => each.name.startsWith("project-number-"));

    expect(tabs).toHaveLength(7);
    expect(new Set(tabs.map((each) => each.visible)).size).toBe(7);

    for (const each of tabs) expect(each.visible.endsWith(each.name.slice(-3))).toBe(true);
  });

  it("u382_the_floor_keeps_four_characters_an_ellipsis_and_the_tail", async () => {
    const tabs = (await open(320)).filter((each) => each.name.startsWith("project-number-"));
    const two = tabs.find((each) => each.name === "project-number-2");

    expect(two?.visible).toBe("proj…r-2");
  });

  it("u382_a_split_space_renders", async () => {
    await open(1280);

    const width = await page.call<number[]>(`() => {
      const measure = (text) => {
        const probe = document.createElement("span");
        probe.style.cssText = "position:absolute;white-space:pre;font:" + getComputedStyle(document.querySelector(".tab-name")).font;
        probe.textContent = text;
        document.body.append(probe);
        const width = probe.getBoundingClientRect().width;
        probe.remove();
        return [width];
      };
      const name = document.querySelector(".tab-name");
      const head = document.createElement("span");
      head.className = "tab-head";
      head.textContent = "roundup ";
      const tail = document.createElement("span");
      tail.className = "tab-tail";
      tail.textContent = "web";
      const holder = document.createElement("span");
      holder.className = "tab-name";
      holder.style.cssText = "position:absolute;visibility:hidden";
      holder.append(head, tail);
      name.parentElement.append(holder);
      const joined = holder.getBoundingClientRect().width;
      holder.remove();
      return [joined, measure("roundup web")[0]];
    }`);

    expect(Math.abs(width[0]! - width[1]!)).toBeLessThan(0.5);
  });
});
