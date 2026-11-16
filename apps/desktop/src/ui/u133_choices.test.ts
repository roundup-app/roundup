import { expect, it } from "vitest";
import { browser, read, url, wait } from "./tabsBrowser";

const load = async () => {
  await browser("open", url("/src/ui/u133.html"));
  await wait('document.querySelectorAll("input[type=radio]").length === 4');
};

// The role=radio button is the control; a Radio's is inside its label, a Segment is the button itself.
const control = (name: string, selector: string, value: "first" | "second") =>
  name === "Radio" ? `${selector}[data-choice=${value}] [role=radio]` : `${selector}[aria-label=${value === "first" ? "First" : "Second"}]`;

it.each([
  ["Radio", ".app-radio", "pointer"],
  ["Radio", ".app-radio", "Space"],
  ["Radio", ".app-radio", "ArrowDown"],
  ["Segment", ".app-segment", "pointer"],
  ["Segment", ".app-segment", "Space"],
  ["Segment", ".app-segment", "ArrowRight"],
])("u133_press_releases_and_activates_once_%s_%s_%s", async (name, selector, input) => {
  await load();
  const second = control(name, selector, "second");

  if (input === "pointer") await browser("click", second);
  else {
    await browser("focus", control(name, selector, input === "Space" ? "second" : "first"));
    await browser("press", input);
  }

  await wait(`document.querySelector('[aria-label="${name} changes"]').textContent === '1'`);
  expect(await read<string | null>(`document.querySelector('${second}').getAttribute('aria-checked')`)).toBe("true");
  expect(await read<number>(`Number(document.querySelector('[aria-label="${name} changes"]').textContent)`)).toBe(1);
}, 60_000);

it.each([
  ["Radio", ".app-radio"],
  ["Segment", ".app-segment"],
])("u133_release_away_does_not_activate_%s", async (name, selector) => {
  await load();

  const point = await read<{ x: number; y: number }>(`(() => {
    const box = document.querySelector('${control(name, selector, "second")}').getBoundingClientRect();
    return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  })()`);

  await browser("mouse", "move", String(point.x), String(point.y));
  await browser("mouse", "down");
  await browser("mouse", "move", "1200", "400");
  await browser("mouse", "up");
  expect(await read<number>(`Number(document.querySelector('[aria-label="${name} changes"]').textContent)`)).toBe(0);
  expect(await read<string | null>(`document.querySelector('${control(name, selector, "first")}').getAttribute('aria-checked')`)).toBe("true");
}, 60_000);

it.each([
  ["Radio", ".app-radio"],
  ["Segment", ".app-segment"],
])("u133_blur_clears_choice_press_%s", async (name, selector) => {
  await load();
  const item = control(name, selector, "second");
  const active = `${selector}[data-pressed], ${selector} [data-pressed]`;

  await browser("focus", item);
  await browser("keydown", " ");
  await wait(`!!document.querySelector('${active}')`);
  await browser("focus", "[data-away]");
  await browser("keyup", " ");
  await browser("focus", item);

  expect(await read<boolean>(`!!document.querySelector('${active}')`)).toBe(false);
  expect(await read<number>(`Number(document.querySelector('[aria-label="${name} changes"]').textContent)`)).toBe(0);
}, 60_000);
