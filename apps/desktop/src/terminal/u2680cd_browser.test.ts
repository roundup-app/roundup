import { beforeAll, expect, it } from "vitest";
import { browser, read, wait } from "../ui/tabsBrowser";
import { app, batch, doubleAt, drag, editor, placement, point, selectRow, setViewport } from "./u514_support";

beforeAll(setViewport);

// Every surface shares the one `user-select: none` chrome rule, so one title-bar, one Rail and one Shelf surface represent it.
const chromeSurfaces = [".traffic-lights", '[data-id="migrate"] .name', ".shelf-tabs"];

it.each(["drag", "double-click"])(
  "u2680c_chrome_drag_and_double_click_leave_no_browser_selection_%s", async gesture => {
    await app();

    for (const surface of chromeSurfaces) {
      await wait(`!!document.querySelector(${JSON.stringify(surface)})`);

      if (gesture === "drag") await drag(await point(surface), await point(surface, true));
      else await browser("dblclick", surface);

      expect(await read<boolean>("getSelection().isCollapsed"), surface).toBe(true);
    }
  }, 60_000);

it.each(["pane-across-shelf", "blank-bubbles-into-pane"])("u2680c_chrome_drag_and_double_click_leave_no_browser_selection_%s", async (surface) => {
  const selector = await placement("bubble", false, undefined, true);

  const from = surface === "pane-across-shelf" ? await point(".pane") : await read<{ x: number; y: number }>(`(() => {
    const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: Math.ceil(box.right + 20), y: Math.round(box.top + 8) };
  })()`);

  await drag(from, await point(surface === "pane-across-shelf" ? ".shelf" : ".pane"));
  expect(await read<boolean>("getSelection().isCollapsed")).toBe(true);
}, 90_000);

// The copy path is shared; the rich editor takes a double-click and the plain input a drag.
it.each([{ kind: "pad", gesture: "double-click" }, { kind: "rename", gesture: "drag" }] as const)("u2680d_editors_keep_native_selection_and_copy_$kind ($gesture)", async ({ kind, gesture }) => {
  const selector = await editor(kind);
  const before = await read<string>(`document.querySelector(${JSON.stringify(selector)}).value ?? document.querySelector(${JSON.stringify(selector)}).textContent`);

  if (gesture === "drag") {
    // Rename initially selects its full name; collapse it before starting a new pointer selection.
    await batch(
      ["wait", "--fn", `document.activeElement === document.querySelector(${JSON.stringify(selector)})`],
      ["press", "Home"],
      ["wait", "--fn", `document.querySelector(${JSON.stringify(selector)}).selectionStart === document.querySelector(${JSON.stringify(selector)}).selectionEnd`]
    );

    const from = await read<{ x: number; y: number }>(`(() => {
      const editor = document.querySelector(${JSON.stringify(selector)});
      const box = (editor.querySelector('p') ?? editor).getBoundingClientRect();
      return { x: Math.round(box.left + 4), y: Math.round(box.top + (editor.matches('input, textarea') ? box.height / 2 : 8)) };
    })()`);

    await drag(from, { x: from.x + 25, y: from.y });
  } else if (kind === "pad") {
    const at = await read<{ x: number; y: number }>("(() => { const box = document.querySelector('.ProseMirror p').getBoundingClientRect(); return { x: Math.round(box.left + 15), y: Math.round(box.top + 8) }; })()");

    await doubleAt(at);
  } else await browser("dblclick", selector);

  const text = await read<string>(`(() => {
    const editor = document.querySelector(${JSON.stringify(selector)});
    window.__editor = editor;
    return editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement
      ? editor.value.slice(editor.selectionStart, editor.selectionEnd) : getSelection().toString();
  })()`);

  expect(text, `${kind} ${gesture}`).not.toBe("");
  await browser("clipboard", "copy");
  const selected = "window.__editor instanceof HTMLInputElement || window.__editor instanceof HTMLTextAreaElement ? window.__editor.value.slice(window.__editor.selectionStart, window.__editor.selectionEnd) : getSelection().toString()";

  expect(await read<string>(selected)).not.toBe("");
  await browser("click", ".traffic-lights");
  expect(await read<string>(selected)).toBe("");
  expect(await read<string>("window.__editor.value ?? window.__editor.textContent")).toBe(before);
  await batch(
    ["eval", "(() => { const input = document.createElement('input'); input.id = 'copy-result'; input.style.position = 'fixed'; input.style.top = '50px'; document.body.append(input); input.focus(); })()"],
    ["press", "Control+V"]
  );
  expect(await read<string>("document.querySelector('#copy-result').value"), `${kind} ${gesture}`).toBe(text);
  await browser("eval", "document.querySelector('#copy-result').remove(); window.__editor.focus()");

}, 120_000);

it("u2680c_readonly_content_keeps_native_selection_and_copy_pad", async () => {
  await app();
  await selectRow("agent-1");
  await batch(
    ["click", "#shelf-tab-pads"],
    ["wait", "--fn", "document.querySelector('#shelf-tab-pads')?.getAttribute('aria-selected') === 'true'"],
    ["wait", "--fn", "document.querySelector('.pads-tab [data-shelf-group=unassigned] .shelf-group-control')?.checkVisibility()"],
    ["eval", "document.querySelector('.pads-tab [data-shelf-group=unassigned] .shelf-group-control[aria-expanded=false]')?.click()"],
    ["wait", "--fn", "document.querySelector('[data-pad=pad-0] .pad-name')?.textContent === 'pad-0'"],
    ["eval", "document.querySelector('[data-pad=pad-0] .pad-name').focus()"],
    ["wait", "--fn", "document.activeElement?.matches('.pad-name')"],
    ["press", "Enter"]
  );
  const selector = '.pad-rich-editor .ProseMirror p';

  await wait(`!!document.querySelector(${JSON.stringify(selector)})`);

  const from = await read<{ x: number; y: number }>(`(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(${JSON.stringify(selector)}));
    const box = range.getClientRects()[0];
    return { x: Math.ceil(box.left + 1), y: Math.round(box.top + box.height / 2) };
  })()`);

  await drag(from, { x: from.x + 55, y: from.y });
  const text = await read<string>("getSelection().toString()");

  expect(text).not.toBe("");
  await batch(
    ["clipboard", "copy"],
    ["eval", "(() => { const input = document.createElement('input'); input.id = 'copy-result'; input.style.position = 'fixed'; input.style.top = '50px'; document.body.append(input); input.focus(); })()"],
    ["press", "Control+V"]
  );
  expect(await read<string>("document.querySelector('#copy-result').value")).toBe(text);
}, 120_000);
