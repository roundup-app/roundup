import { expect, it } from "vitest";
import { browser, read, url, wait } from "./tabsBrowser";

const controls = [
  ["Button", "button", "Enter"], ["Button", "button", " "],
  ["Checkbox", "input", " "], ["Switch", "input", " "],
  ["Toggle", "button", "Enter"], ["Toggle", "button", " "],
  ["Tab", "button[data-value=second]", "Enter"], ["Tab", "button[data-value=second]", " "],
];

const load = async () => {
  await browser("open", url("/src/ui/u133.html"));
  await wait('!!document.querySelector("[data-away]")');
};

it.each(controls)("u133_press_releases_and_activates_once_%s_%s_%s", async (name, control, key) => {
  await load();
  await browser("focus", `[data-control=${name}] ${control}`);
  await browser("press", key === " " ? "Space" : key!);
  await wait(`document.querySelector('[aria-label="${name} changes"]').textContent === '1'`);
  expect(await read<number>(`Number(document.querySelector('[aria-label="${name} changes"]').textContent)`)).toBe(1);
}, 60_000);

it.each(["Enter", " "])("u133_blur_clears_native_button_press_%s", async (key) => {
  await load();
  await browser("focus", "[data-control=Button] button");
  await browser("keydown", key);
  await browser("focus", "[data-away]");
  await browser("keyup", key);
  expect(await read<number>(`Number(document.querySelector('[aria-label="Button changes"]').textContent)`)).toBe(0);
  await browser("focus", "[data-control=Button] button");
  await browser("press", key === " " ? "Space" : key);
  expect(await read<number>(`Number(document.querySelector('[aria-label="Button changes"]').textContent)`)).toBe(1);
}, 60_000);

it.each([
  ["Button", "button"], ["Checkbox", "input"], ["Switch", "input"], ["Toggle", "button"],
])("u133_release_away_does_not_activate_%s", async (name, control) => {
  await load();

  const point = await read<{ x: number; y: number }>(`(() => {
    const box = document.querySelector('[data-control=${name}] ${control}').getBoundingClientRect();
    return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  })()`);

  await browser("mouse", "move", String(point.x), String(point.y));
  await browser("mouse", "down");
  await browser("mouse", "move", "1200", "400");
  await browser("mouse", "up");
  expect(await read<number>(`Number(document.querySelector('[aria-label="${name} changes"]').textContent)`)).toBe(0);
}, 60_000);
