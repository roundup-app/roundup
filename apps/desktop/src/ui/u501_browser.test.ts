import { expect, it } from "vitest";
import { browser, read, url, wait } from "./tabsBrowser";

const load = async () => {
  await browser("open", url("/src/ui/u501.html"));
  await wait(`Number(document.querySelector('[data-fixture=listbox]')?.dataset.commit) > 0`);
};

const action = async (...args: string[]) => {
  const commit = await read<number>(`Number(document.querySelector('[data-fixture=listbox]').dataset.commit)`);
  await browser(...args);
  // The fixture acknowledges input after its render frame, including Ark's state update.
  await wait(`Number(document.querySelector('[data-fixture=listbox]').dataset.commit) > ${commit}`);
};

const choice = async (index: number | null) => {
  await wait(`[...document.querySelectorAll('[role=option]')].map(el => el.getAttribute('aria-selected')).join(',') === '${[0, 1, 2].map(at => String(at === index)).join(",")}'`);
  expect(await read<unknown>(`(() => {
    const note = document.querySelector('input');
    const active = note.getAttribute('aria-activedescendant');
    return [document.querySelectorAll('[role=option]').length, note.value, !active || !!document.getElementById(active), document.querySelector('output').textContent];
  })()`)).toEqual([3, "unchanged draft", true, "0"]);
};

it("u501_browser_navigation_keeps_note_focus_and_text", async () => {
  await load();
  expect(await read<string>("document.activeElement.tagName")).toBe("BODY");
  await choice(0);

  for (const source of ["[role=listbox]", "input"]) {
    if (source === "[role=listbox]") {
      await action("click", "button:first-child");
      await action("press", "Tab");
    } else await action("click", source);

    for (const [key, sequence] of [["ArrowDown", [1, 2, null, 0]], ["ArrowUp", [null, 2, 1, 0]]] as const) {
      for (const index of sequence) {
        await action("press", key);
        await choice(index);
        expect(await read<boolean>(`document.activeElement === document.querySelector('${source}')`)).toBe(true);
      }
    }
  }
}, 120_000);

it("u501_browser_pointer_never_submits_and_enter_stays_with_note_owner", async () => {
  await load();
  await action("click", '[data-value="answer:full"]');
  await choice(2);
  await action("click", "input");
  await action("press", "Enter");
  expect(await read<string>("document.querySelector('output').textContent")).toBe("1");
}, 60_000);

it("u501_browser_pending_keeps_note_focus_and_blocks_repeat_enter", async () => {
  await load();
  await action("click", "input");
  await action("eval", `[...document.querySelectorAll('button')].find(el => el.textContent === 'Toggle pending').click()`);
  await action("press", "ArrowDown");
  await action("press", "Enter");
  await choice(0);
  expect(await read<unknown>(`(() => { const input = document.querySelector('input'); return [document.activeElement === input, input.readOnly, input.disabled]; })()`)).toEqual([true, true, false]);
  await action("eval", `[...document.querySelectorAll('button')].find(el => el.textContent === 'Toggle pending').click()`);
  await action("press", "Enter");
  expect(await read<string>("document.querySelector('output').textContent")).toBe("1");
}, 60_000);
