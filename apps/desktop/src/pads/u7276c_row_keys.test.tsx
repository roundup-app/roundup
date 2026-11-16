import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import type { FakeApp } from "../testing/fakeApp";
import { AGENT, openShelf, padOf } from "./padsFixture";

afterEach(cleanup);

const shown = () => [...document.querySelectorAll<HTMLElement>("[data-pad]")].map(row => row.dataset.pad ?? "");

const nameOf = (pad: string) => {
  const name = document.querySelector<HTMLElement>(`[data-pad="${pad}"] .pad-name`);

  if (!name) throw new Error(`no pad row ${pad}`);

  return name;
};

const reorders = (app: FakeApp) => app.calls.filter(call => call.method === "pad.reorder").map(call => call.params);

const press = (pad: string, key: "ArrowUp" | "ArrowDown") => {
  nameOf(pad).focus();
  fireEvent.keyDown(nameOf(pad), { key, code: key, altKey: true });
};

it("u7276c_alt_up_and_down_move_one_slot_in_pads", async () => {
  const { app } = await openShelf(["a", "b", "c"].map(name => padOf(name, AGENT)));
  const [first = "", second = "", third = ""] = shown();

  press(first, "ArrowDown");
  await waitFor(() => expect(shown()).toEqual([second, first, third]));
  expect(reorders(app)).toHaveLength(1);
  await waitFor(() => expect(document.activeElement).toBe(nameOf(first)));

  press(first, "ArrowUp");
  await waitFor(() => expect(shown()).toEqual([first, second, third]));
  expect(reorders(app)).toHaveLength(2);
  await waitFor(() => expect(document.activeElement).toBe(nameOf(first)));
});

it("u7276c_a_refused_or_end_move_calls_nothing", async () => {
  const { app } = await openShelf(["a", "b", "c"].map(name => padOf(name, AGENT)));
  const order = shown();

  press(order.at(0) ?? "", "ArrowUp");
  press(order.at(-1) ?? "", "ArrowDown");
  expect(reorders(app)).toEqual([]);
  expect(shown()).toEqual(order);
});
