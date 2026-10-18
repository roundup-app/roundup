import { afterAll, beforeAll, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

let page: ChromePage;

// One representative case: the densest seed, the only one that reaches the failed add, in the narrowest supported layout.
const [seed, windowWidth, shelfWidth] = ["tree-40", 1280, 240] as const;

const evaluate = <T,>(script: string): Promise<T> => page.call<T>(`() => (${script})`);

// The page's action timeout for an element or text to appear.
const wait = (predicate: string) => page.until(`() => ${predicate}`, 25_000);

// Shelf.select queues focus; its microtask finishes before the next rendered frame.
const settle = () => evaluate("new Promise(resolve => requestAnimationFrame(() => resolve(true)))");

beforeAll(async () => {
  const chrome = chromePath();

  if (!chrome) throw new Error("U465 requires headless Chromium");
  page = await openPage(chrome);
  await page.scheme("light");
}, 60_000);

afterAll(async () => {
  await page?.close();
});

// Loads `seed` from the page's own server in a `windowWidth` by 800 window, once the document has loaded.
const open = async (seed: string, width: number, windowWidth: number) => {
  const path = `harness.html?seed=${seed}`;

  await page.load(`/${path}`, windowWidth, 800);

  try { await wait("document.readyState === 'complete' && !!document.querySelector('.shelf-tabs')"); } catch (error) { console.error(await evaluate<string>("document.body.outerHTML")); throw error; }

  await evaluate(`(() => { localStorage.clear(); document.querySelector('.window').style.setProperty('--shelf-span', '${width}px'); if (document.querySelector('#shelf-tab-todos').getAttribute('aria-expanded') !== 'true') document.querySelector('#shelf-tab-todos').click(); return true; })()`);
  await settle();
};

const select = async (tab: string) => {
  await evaluate(`(() => { document.querySelector('#shelf-tab-${tab}').click(); return true; })()`);
  await settle();
};

it("u465_heads_keep_tab_focus_and_visible_failure", async () => {
  await open(seed, shelfWidth, windowWidth);
  await select("pads");
  await evaluate(`(() => { document.querySelector('#shelf-tab-pads').focus(); return true; })()`);
  await page.press("Home", "Home");
  await settle();
  expect(await evaluate<string>("document.activeElement.id")).toBe("shelf-tab-todos");
  await wait(`!!document.querySelector('button[aria-label="Add Todo"]')`);
  const add = await evaluate<{ x: number; y: number }>(`(() => { const button = document.querySelector('button[aria-label="Add Todo"]'); button.scrollIntoView({ block: 'nearest' }); const box = button.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; })()`);
  await page.click(add.x, add.y);
  await wait(`!!document.querySelector('[aria-label="New Todo title"]')`);
  await evaluate(`(() => { window.__fake.failNext(-32003, 'U465 Todo add failed'); const input = document.querySelector('[aria-label="New Todo title"]'); input.value = 'U465 rejected Todo'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`);
  await wait("document.body.innerText.includes('U465 Todo add failed')");
}, 120_000);
