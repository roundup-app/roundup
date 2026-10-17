import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { CHECK_IDS, type Checks } from "../testing/checks";
import { browser, read, url, wait } from "../ui/tabsBrowser";
import { FULLSCREEN } from "../testing/chromePage";

const source = new URL("./u509Fixture.tsx", import.meta.url).pathname;

const fixture = source.slice(source.lastIndexOf("/src/")).replace("Fixture.tsx", ".html");

const load = async (query = "") => {
  await browser("set", "viewport", "1280", "800");
  await browser("open", url(`${fixture}${query}`));
  await wait(`document.querySelector('.rail-agent-actions > button:not([aria-disabled])')`);
};


const state = () => read<{ adds: number; closes: number; pair: unknown }>(`({ adds: window.__form.adds(), closes: window.__form.closes(), pair: window.__form.pair() })`);

it("u509_shared_select_pointer_and_keyboard", async () => {
  await load();
  expect(await read<boolean>(`[...document.querySelectorAll('select')].every(select => select.closest('[data-scope=select]') !== null && select.getBoundingClientRect().width <= 1)`)).toBe(true);
  await browser("click", `[aria-label="Model"]`);
  await wait(`document.querySelector('[role=listbox]')`);
  await browser("click", `[role=option]:nth-child(3)`);
  await wait(`window.__form.pair().model === 'm-sonnet'`);
  expect((await state()).pair).toEqual({ model: "m-sonnet", effort: null });
  await browser("focus", `[aria-label="Effort"]`);
  await browser("press", "ArrowDown");
  await wait(`document.querySelector('[role=listbox]')`);
  await browser("press", "ArrowDown");
  await browser("press", "Enter");
  await wait(`window.__form.pair().effort !== null`);
  expect((await state()).pair).toMatchObject({ model: "m-sonnet" });
}, 90_000);

it("u509_select_escape_preserves_the_form", async () => {
  await load();
  await browser("focus", `[aria-label="Model"]`);
  await browser("press", "ArrowDown");
  await wait(`document.querySelector('[role=listbox]')`);
  await browser("press", "Escape");
  await wait(`!document.querySelector('[role=listbox]')`);
  expect((await state()).closes).toBe(0);
  await browser("press", "Escape");
  await wait(`window.__form.closes() === 1`);
}, 90_000);

it("u509_action_states_and_grouping", async () => {
  await load();

  const geometry = await read<{ gap: number; surface: string; ink: string; label: string }>(`(() => {
    const fields = document.querySelector('.rail-agent-fields').getBoundingClientRect();
    const button = document.querySelector('.rail-agent-actions > button');
    const style = getComputedStyle(button);
    return { gap: button.getBoundingClientRect().top - fields.bottom, surface: style.backgroundColor, ink: style.color, label: button.textContent };
  })()`);

  expect(geometry.gap).toBeGreaterThan(0);
  expect(geometry.label).toBe("Add agent");
  expect(geometry.surface).not.toBe("rgba(0, 0, 0, 0)");
  await browser("eval", `window.__form.setDisabled(true)`);
  await wait(`document.querySelector('.rail-agent-actions > button').getAttribute('aria-disabled') === 'true'`);
  const disabledInk = await read<string>(`getComputedStyle(document.querySelector('.rail-agent-actions > button')).color`);
  expect(disabledInk).not.toBe(geometry.ink);
  await browser("click", ".rail-agent-actions > button");
  expect((await state()).adds).toBe(0);
  await browser("eval", `window.__form.setDisabled(false)`);
  await wait(`!document.querySelector('.rail-agent-actions > button').hasAttribute('aria-disabled')`);
  await browser("click", ".rail-agent-actions > button");
  await wait(`window.__form.adds() === 1`);
}, 90_000);

it("u509_form_fits_dense_and_long_choices", async () => {
  await load("?dense");
  await browser("click", `[aria-label="Model"]`);
  await wait(`document.querySelector('[role=listbox]')`);

  const fit = await read<{ page: boolean; list: boolean; last: boolean }>(`(() => {
    const list = document.querySelector('[role=listbox]');
    const box = list.getBoundingClientRect();
    list.scrollTop = list.scrollHeight;
    const last = [...list.querySelectorAll('[role=option]')].at(-1).getBoundingClientRect();
    const lb = list.getBoundingClientRect();
    return { page: document.documentElement.scrollWidth <= innerWidth, list: box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight, last: last.bottom <= lb.bottom + 1 && last.top >= lb.top };
  })()`);

  expect(fit).toEqual({ page: true, list: true, last: true });
}, 90_000);

const art = captureDir("U509");

const MOVED: readonly string[] = ["D1", "D2", "D5", "D6", "D7"];

for (const scheme of ["light", "dark"]) for (const width of [FULLSCREEN.width]) {
  it(`u509_form_preserves_checks ${scheme}-${width}`, async () => {
    await browser("set", "media", scheme);
    const readings: Record<string, Checks> = {};

    const capture = async (name: string) => {
      await browser("set", "viewport", String(width), "800");
      const checks = await read<Checks>("import('/src/testing/checks.ts').then(module => module.runChecks())");

      readings[name] = checks;

      if (art) {
        mkdirSync(join(art, "head"), { recursive: true });
        await browser("screenshot", join(art, "head", `${scheme}-${width}-${name}.png`));
        writeFileSync(join(art, "head", `${scheme}-${width}-${name}.checks.json`), JSON.stringify(checks));
      }
    };

    await load("?dense");
    await capture("closed");
    await browser("click", `[aria-label="Model"]`);
    await wait(`document.querySelector('[role=listbox]')`);
    await capture("open-options");
    await browser("click", `[role=option]:nth-child(3)`);
    await wait(`window.__form.pair().model !== null`);
    await capture("changed-pair");
    await browser("eval", `window.__form.setDisabled(true)`);
    await wait(`document.querySelector('.rail-agent-actions > button').getAttribute('aria-disabled') === 'true'`);
    await capture("disabled");
    await browser("open", url(`${fixture}?dense&fail`));
    await wait(`document.querySelector('[role=alert]')`);
    await capture("failed");

    for (const [name, checks] of Object.entries(readings)) for (const id of CHECK_IDS) if (MOVED.includes(id)) expect(checks[id].status, `${name} ${id}: ${JSON.stringify(checks[id])}`).toBe("pass");
  }, 180_000);
}
