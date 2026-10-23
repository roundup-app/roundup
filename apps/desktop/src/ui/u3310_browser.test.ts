import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { browser, read, url, wait } from "./tabsBrowser";
import { captureDir } from "../testing/captures";

const action = async (...args: string[]) => {
  const commit = await read<number>(`Number(document.querySelector('[data-fixture=switch]').dataset.commit)`);

  await browser(...args);
  // u3310Fixture acknowledges document input after the library handles it.
  await wait(`Number(document.querySelector('[data-fixture=switch]').dataset.commit) > ${commit}`);
};

const capture = async (step: string) => {
  const dir = captureDir("U3310");

  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await browser("screenshot", join(dir, `${step}.png`));
  writeFileSync(join(dir, `${step}.checks.json`), JSON.stringify(await read("window.__checks()")));
};

it("u3310_the_switch_is_a_labelled_keyboard_reachable_switch", async () => {
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
  await browser("open", url(new URL("./u3310Fixture.tsx", import.meta.url).pathname.replace("Fixture.tsx", ".html")));
  await wait(`Number(document.querySelector('[data-fixture=switch]')?.dataset.commit) > 0`);
  await capture("unchecked");
  await action("find", "role", "button", "click", "--name", "Before", "--exact");
  await action("press", "Tab");
  expect(await read<string>(`document.activeElement?.getAttribute('role')`)).toBe("switch");
  const snapshot: { data: { snapshot: string } } = JSON.parse(await browser("snapshot"));

  expect(snapshot.data.snapshot).toContain('switch "Auto"');
  await action("press", "Space");
  expect(await read<string>(`document.querySelector('output').textContent`)).toBe("[true]");
  expect(await read<string>(`document.querySelector('[role=switch]').getAttribute('aria-checked')`)).toBe("false");
  await capture("keyboard-pending");
  await action("find", "role", "button", "click", "--name", "Acknowledge", "--exact");
  await wait(`document.querySelector('[role=switch]').getAttribute('aria-checked') === 'true'`);
  await capture("checked");
  await action("find", "role", "button", "click", "--name", "Toggle disabled", "--exact");
  await action("find", "role", "button", "click", "--name", "Before", "--exact");
  await action("press", "Tab");
  expect(await read<string>("document.activeElement?.textContent")).toBe("Acknowledge");
  await action("press", "Shift+Tab");
  await action("press", "Space");
  expect(await read<string>(`document.querySelector('output').textContent`)).toBe("[true]");
  await capture("disabled");
}, 60_000);
