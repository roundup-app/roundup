import { expect, it } from "vitest";
import { browser, read, url, wait } from "./tabsBrowser";

const load = async () => {
  await browser("open", url("/src/ui/u133.html"));
  await wait('document.querySelectorAll("input[type=radio]").length === 4');
};

it.each([
  ["Radio", ".app-radio", "pointer"],
  ["Radio", ".app-radio", "Space"],
  ["Radio", ".app-radio", "ArrowDown"],
  ["Segment", ".app-segment", "pointer"],
  ["Segment", ".app-segment", "Space"],
  ["Segment", ".app-segment", "ArrowRight"],
])("u133_press_releases_and_activates_once_%s_%s_%s", async (name, selector, input) => {
  await load();
  const second = `${selector} input[value=second]`;

  if (input === "pointer") await browser("click", `${selector}:last-child`);
  else {
    await browser("focus", `${selector} input[value=${input === "Space" ? "second" : "first"}]`);
    await browser("press", input);
  }

  await wait(`document.querySelector('[aria-label="${name} changes"]').textContent === '1'`);
  expect(await read<boolean>(`document.querySelector('${second}').checked`)).toBe(true);
  expect(await read<number>(`Number(document.querySelector('[aria-label="${name} changes"]').textContent)`)).toBe(1);
}, 60_000);

it.each([
  ["Radio", ".app-radio"],
  ["Segment", ".app-segment"],
])("u133_release_away_does_not_activate_%s", async (name, selector) => {
  await load();

  const point = await read<{ x: number; y: number }>(`(() => {
    const box = document.querySelector('${selector}:last-child').getBoundingClientRect();
    return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  })()`);

  await browser("mouse", "move", String(point.x), String(point.y));
  await browser("mouse", "down");
  await browser("mouse", "move", "1200", "400");
  await browser("mouse", "up");
  expect(await read<number>(`Number(document.querySelector('[aria-label="${name} changes"]').textContent)`)).toBe(0);
  expect(await read<boolean>(`document.querySelector('${selector} input[value=first]').checked`)).toBe(true);
}, 60_000);

it.each([
  ["Radio", ".app-radio"],
  ["Segment", ".app-segment"],
])("u133_blur_clears_choice_press_%s", async (name, selector) => {
  await load();
  const input = `${selector} input[value=second]`;
  const active = `${selector} [data-part=item-control][data-active]`;

  await browser("focus", input);
  await browser("keydown", " ");
  await wait(`!!document.querySelector('${active}')`);
  await browser("focus", "[data-away]");
  await browser("keyup", " ");
  await browser("focus", input);

  expect(await read<boolean>(`!!document.querySelector('${active}')`)).toBe(false);
  expect(await read<number>(`Number(document.querySelector('[aria-label="${name} changes"]').textContent)`)).toBe(0);
}, 60_000);
