import { expect, it } from "vitest";
import { browser, read, url, wait } from "./tabsBrowser";

const controls = [
  ["Button", "button", "Enter"], ["Button", "button", " "],
  ["Checkbox", "input", " "], ["Switch", "input", " "],
  ["Toggle", "button", "Enter"], ["Toggle", "button", " "],
  ["Tab", "button[value=second]", "Enter"], ["Tab", "button[value=second]", " "],
];

const load = async () => {
  await browser("open", url("/src/ui/u133.html"));
  await wait('!!document.querySelector("[data-away]")');
};

it.each(controls)("u133_press_releases_and_activates_once_%s_%s_%s", async (name, control, key) => {
  await load();
  await browser("focus", `[data-control=${name}] ${control}`);
  await browser("keydown", key!);
  await browser("keyup", key!);
  await wait(`document.querySelector('[aria-label="${name} changes"]').textContent === '1'`);
  expect(await read<string>(`document.querySelector('[aria-label="${name} changes"]').textContent`)).toBe("1");
}, 60_000);

it.each(["Enter", " "])("u133_blur_clears_native_button_press_%s", async (key) => {
  await load();
  await browser("focus", "[data-control=Button] button");
  await browser("keydown", key);
  expect(await read<boolean>(`document.activeElement.matches('[data-pressed="true"]')`)).toBe(true);
  await browser("focus", "[data-away]");
  await browser("keyup", key);
  expect(await read<boolean>(`!!document.querySelector('[data-pressed="true"]')`)).toBe(false);
  expect(await read<string>(`document.querySelector('[aria-label="Button changes"]').textContent`)).toBe(key === "Enter" ? "1" : "0");
}, 60_000);
