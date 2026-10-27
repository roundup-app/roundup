import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { createSignal, For } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { createRowCollection, rowKey } from "./RowCollection";

afterEach(cleanup);

const mount = (onFocus = vi.fn<(value: string) => void>()) => {
  const all = Array.from({ length: 5 }, (_, index) => ({ value: `row-${index}`, label: `Name ${index}` }));
  const [items, setItems] = createSignal(all);
  const [rows, setRows] = createSignal(all.slice(0, 2));
  const onActivate = vi.fn();
  let holder!: ReturnType<typeof createRowCollection>;
  const view = render(() => {
    holder = createRowCollection(items, { onFocus, onActivate });

    return <For each={rows()}>{item => <button ref={row => holder.register(row, item.value)} onKeyDown={rowKey}>{item.label}</button>}</For>;
  });
  const row = (value: string) => view.container.querySelector<HTMLButtonElement>(`[data-collection-value="${value}"]`)!;
  row("row-0").focus();

  return { all, holder, row, setRows, setItems, onFocus, onActivate, dispose: view.unmount };
};

it("z3788d_End_completes_focus_once_when_the_requested_row_mounts", async () => {
  const list = mount();
  fireEvent.keyDown(list.row("row-0"), { key: "End" });
  expect(list.onFocus.mock.calls).toEqual([["row-4"]]);
  list.setRows(list.all.slice(3));
  const focus = vi.spyOn(list.row("row-4"), "focus");
  // RowCollection completes registration after Solid has attached ref-created rows.
  await Promise.resolve();
  expect(document.activeElement).toBe(list.row("row-4"));
  expect(focus).toHaveBeenCalledOnce();
  expect(list.onActivate).not.toHaveBeenCalled();
});
