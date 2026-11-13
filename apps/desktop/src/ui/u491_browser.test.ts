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
  await wait(`document.querySelector('[aria-label=Ends]').textContent === '0'`);
  await browser("press", "Escape");
  await wait(`document.querySelector('[data-layout-panel=rail]').getBoundingClientRect().width === 288`);
  await browser("mouse", "up");
  await wait(`document.querySelector('[aria-label=Ends]').textContent === '0'`);
  await browser("mouse", "move", "286", "200");
  await browser("mouse", "down");
  await browser("mouse", "move", "900", "200");
  await wait(`document.querySelector('[data-layout-panel=rail]').getBoundingClientRect().width === 480`);
  await browser("mouse", "up");
  await wait(`document.querySelector('[aria-label=Ends]').textContent === '1'`);
  await browser("mouse", "move", "478", "200");
  await browser("mouse", "down");
  await browser("mouse", "move", "0", "200");
  // U6228: a drag below the minimum collapses the Rail to its 56 px strip.
  await wait(`document.querySelector('[data-layout-panel=rail]').getBoundingClientRect().width === 56`);
  await browser("mouse", "up");
  await wait(`document.querySelector('[aria-label=Ends]').textContent === '2'`);
  await wait(`(() => {
    const draft = document.querySelector('[aria-label=Draft]');
    return draft.value === 'Kept draft' && draft.selectionStart === 2 && draft.selectionEnd === 8 && document.querySelector('.centre > div').scrollTop === 120;
  })()`);
}, 90_000);


it("u492_tab_leaves_toast_for_next_document_control", async () => {
  await load();
  await browser("find", "role", "button", "click", "--name", "Notify", "--exact");
  await wait(`document.querySelector('.app-toast-action')`);
  await browser("focus", ".app-toast-action");
  await browser("press", "Tab");
  expect(await read<boolean>(`document.activeElement?.matches('.shelf-edge')`)).toBe(true);
  await browser("press", "Shift+Tab");
  expect(await read<boolean>(`document.activeElement?.matches('.app-toast-action')`)).toBe(true);
}, 90_000);

it("u7059_pointer_in_a_gap_keeps_the_stack_fanned_out", async () => {
  await browser("set", "viewport", "1280", "800");
  await load();
  await read(`(() => { for (const id of ['a', 'b', 'c']) window.__providers.toast.show({ id, name: 'Card ' + id, content: 'Body ' + id, duration: Infinity }); })()`);
  await wait(`document.querySelectorAll('.app-toast').length === 3`);
  // The fixture lacks the two Tokens the group's bottom offset reads, which leaves the group at the top of the page.
  await read(`document.documentElement.style.cssText += '--hint-row-height: 24px; --rail-actions-height: 24px;'`);
  const rects = `[...document.querySelectorAll('.app-toast')].map((card) => card.getBoundingClientRect()).sort((a, b) => a.top - b.top)`;
  const front = await read<{ x: number, y: number }>(`(() => { const rect = [...document.querySelectorAll('.app-toast:not([data-sibling])')][0].getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; })()`);
  await browser("mouse", "move", String(front.x), String(front.y));
  await wait(`!document.querySelector('.app-toast[data-sibling]').hasAttribute('data-overlap')`);
  const state = `(() => ({ folded: [...document.querySelectorAll('.app-toast')].map((card) => card.hasAttribute('data-overlap')) }))()`;
  await wait(`${rects}.every((rect, index, all) => index === 0 || rect.top >= all[index - 1].bottom)`);
  const before = await read<unknown>(state);
  const gap = await read<{ x: number, y: number }>(`(() => { const all = ${rects}; return { x: all[0].x + all[0].width / 2, y: (all[0].bottom + all[1].top) / 2 }; })()`);
  await browser("mouse", "move", String(gap.x), String(gap.y));
  await new Promise((resolve) => setTimeout(resolve, 600));
  expect(await read<unknown>(state)).toEqual(before);
}, 90_000);
