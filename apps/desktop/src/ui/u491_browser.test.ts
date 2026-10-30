import { expect, it } from "vitest";
import { browser, read, url, wait } from "./tabsBrowser";

const source = new URL("./u491Fixture.tsx", import.meta.url).pathname;

const fixture = source.slice(source.lastIndexOf("/src/")).replace("Fixture.tsx", ".html");

const load = async () => {
  await browser("open", url(fixture));
  await wait(`document.querySelectorAll('.app-splitter').length === 2`);
};

const key = async (name: string, key: string) => {
  await browser("focus", `[aria-label="${name}"]`);
  await browser("press", key);
};

const tabTo = async (selector: string) => {
  for (let step = 0; step < 12; step++) {
    if (await read<boolean>(`document.activeElement?.matches('${selector}')`)) return;
    await browser("press", "Tab");
  }

  expect(await read<boolean>(`document.activeElement?.matches('${selector}')`)).toBe(true);
};

it("u491_keys_limits_and_reset_Resize Rail", async () => {
  const name = "Resize Rail";
  const expected = [304, 368, 480, 252, 288];
  await load();
  const selector = `[aria-label="${name}"]`;
  const keys = ["ArrowRight", "Shift+ArrowRight", "End", "Home", "Enter"];

  for (const [index, input] of keys.entries()) {
    await key(name, input);
    await wait(`document.querySelector('${selector}').getAttribute('aria-valuenow') === '${expected[index]}'`);
    expect(await read<string>(`document.querySelector('[aria-label=Ends]').textContent`)).toBe(String(index + 1));
  }

  expect(await read<unknown>(`(() => {
    const edge = document.querySelector('${selector}');
    return [edge.getAttribute('aria-orientation'), edge.getAttribute('aria-valuemin'), edge.getAttribute('aria-valuemax')];
  })()`)).toEqual(["vertical", "252", "480"]);
  await key(name, "Home");
  await wait(`document.querySelector('[aria-label=Ends]').textContent === '6'`);
  await browser("dblclick", selector);
  await wait(`document.querySelector('[aria-label=Ends]').textContent === '7'`);
  expect(await read<string>(`document.querySelector('${selector}').getAttribute('aria-valuenow')`)).toBe(String(expected[4]));
}, 90_000);

it("u491_controlled_pixels_follow_owner_and_root", async () => {
  await load();
  await read(`window.__providers.widths.rail.commit(352)`);
  await wait(`document.querySelector('[aria-label="Resize Rail"]').getAttribute('aria-valuenow') === '352'`);

  for (const width of [1440, 1280]) {
    await browser("set", "viewport", String(width), "800");
    await wait(`document.querySelector('[data-layout-root]').getBoundingClientRect().width === ${width}`);
    await key("Resize Rail", "ArrowRight");
    await wait(`document.querySelector('[data-layout-panel=rail]').getBoundingClientRect().width === ${width === 1440 ? 368 : 384}`);
  }

  expect(await read<string>(`document.querySelector('[aria-label=Draft]').value`)).toBe("Retained draft");
}, 90_000);

it("u491_drag_preview_end_and_escape", async () => {
  await browser("set", "viewport", "1280", "800");
  await load();
  await read(`(() => {
    const draft = document.querySelector('[aria-label=Draft]');
    draft.value = 'Kept draft';
    draft.setSelectionRange(2, 8);
    document.querySelector('.centre > div').scrollTop = 120;
  })()`);
  await browser("mouse", "move", "286", "200");
  await browser("mouse", "down");
  await browser("mouse", "move", "416", "200");
  await wait(`document.querySelector('[data-layout-panel=rail]').getBoundingClientRect().width > 400`);
  expect(await read<string>(`document.querySelector('[aria-label=Ends]').textContent`)).toBe("0");
  await browser("press", "Escape");
  await wait(`document.querySelector('[data-layout-panel=rail]').getBoundingClientRect().width === 288`);
  await browser("mouse", "up");
  expect(await read<string>(`document.querySelector('[aria-label=Ends]').textContent`)).toBe("0");
  await browser("mouse", "move", "286", "200");
  await browser("mouse", "down");
  await browser("mouse", "move", "900", "200");
  await wait(`document.querySelector('[data-layout-panel=rail]').getBoundingClientRect().width === 480`);
  await browser("mouse", "up");
  await wait(`document.querySelector('[aria-label=Ends]').textContent === '1'`);
  await browser("mouse", "move", "478", "200");
  await browser("mouse", "down");
  await browser("mouse", "move", "0", "200");
  await wait(`document.querySelector('[data-layout-panel=rail]').getBoundingClientRect().width === 252`);
  await browser("mouse", "up");
  await wait(`document.querySelector('[aria-label=Ends]').textContent === '2'`);
  expect(await read<unknown>(`(() => {
    const draft = document.querySelector('[aria-label=Draft]');
    return [draft.value, draft.selectionStart, draft.selectionEnd, document.querySelector('.centre > div').scrollTop];
  })()`)).toEqual(["Kept draft", 2, 8, 120]);
}, 90_000);


it("u492_tab_leaves_toast_for_next_document_control", async () => {
  await load();
  await browser("find", "role", "button", "click", "--name", "Notify", "--exact");
  await wait(`document.querySelector('.app-toast-action')`);
  await browser("focus", ".app-toast-action");
  await browser("press", "Tab");
  expect(await read<boolean>(`document.activeElement === document.querySelectorAll('[role=separator]')[1]`)).toBe(true);
  await browser("press", "Shift+Tab");
  expect(await read<boolean>(`document.activeElement?.matches('.app-toast-action')`)).toBe(true);
}, 90_000);

it("u492_escape_dismisses", async () => {
  await load();
  await browser("find", "role", "button", "click", "--name", "Notify", "--exact");
  await wait(`document.querySelector('.app-toast-action')`);
  await tabTo(".app-toast-action");
  await browser("press", "Escape");
  await wait(`!document.querySelector('.app-toast')`);
  expect(await read<string>(`document.querySelector('[aria-label=Activations]').textContent`)).toBe("0");
}, 90_000);
