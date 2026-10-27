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

it("z3788d_a_newer_navigation_request_cancels_pending_focus", async () => {
  const list = mount();
  fireEvent.keyDown(list.row("row-0"), { key: "End" });
  fireEvent.keyDown(list.row("row-0"), { key: "ArrowDown" });
  list.setRows(list.all);
  await Promise.resolve();
  expect(document.activeElement).toBe(list.row("row-1"));
});

it("z3788d_filtering_away_an_identity_cancels_its_pending_focus", async () => {
  const list = mount();
  fireEvent.keyDown(list.row("row-0"), { key: "End" });
  list.setItems(list.all.slice(0, 2));
  list.setItems(list.all);
  list.setRows(list.all);
  await Promise.resolve();
  expect(document.activeElement).toBe(list.row("row-0"));
});

it("z3788d_holder_cleanup_cancels_queued_registration_focus", async () => {
  const list = mount();
  fireEvent.keyDown(list.row("row-0"), { key: "End" });
  list.setRows(list.all);
  const focus = vi.spyOn(list.row("row-4"), "focus");
  list.dispose();
  await Promise.resolve();
  expect(focus).not.toHaveBeenCalled();
});

it("z3788d_old_row_cleanup_preserves_a_new_registration_of_the_same_identity", () => {
  const list = mount();
  const replacement = { value: "row-1", label: "Replacement" };
  list.setRows([...list.all.slice(0, 2), replacement]);
  list.setRows([list.all[0]!, replacement]);
  fireEvent.keyDown(list.row("row-0"), { key: "ArrowDown" });
  expect(document.activeElement).toBe(list.row("row-1"));
});

it("z3788d_synchronous_mount_keeps_immediate_focus_and_activation", () => {
  const list = mount(value => list.setRows(list.all.filter(item => item.value === value)));
  fireEvent.keyDown(list.row("row-0"), { key: "End" });
  expect(document.activeElement).toBe(list.row("row-4"));
  fireEvent.keyDown(list.row("row-4"), { key: "Enter" });
  expect(list.onActivate.mock.calls).toEqual([["row-4"]]);
});
