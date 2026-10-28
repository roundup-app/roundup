import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RequestedApp as App } from "../testing/requestedApp";
import { seedApp } from "../testing/seeds";
import { showEverythingInApp } from "../testing/showEverything";
import { copy } from "../copy";

afterEach(() => { cleanup(); localStorage.clear(); });

const open = async () => {
  render(() => <App app={seedApp("tree-40", 0).app} reducedMotion={() => true} clock={() => 0} />);
  await showEverythingInApp();
  fireEvent.click(document.querySelector('.rail-row[data-id="backend"]')!);
  await screen.findByRole("switch", { name: "Auto" });
};

it("u4463_each_head_is_one_row_of_title_and_controls", async () => {
  await open();
  const head = document.querySelector<HTMLElement>("[data-shelf-scope]")!;

  expect(within(head).getByRole("switch", { name: "Auto" })).toBeTruthy();
  expect(within(head).getAllByRole("button").map(button => button.getAttribute("aria-label"))).toEqual(["add todo to backend", "Triage"]);
  fireEvent.click(within(screen.getByRole("tablist", { name: "Work items" })).getByRole("tab", { name: /^Pads/ }));
  await waitFor(() => expect(within(head).getByRole("button", { name: "add pad" })).toBeTruthy());
  expect(within(head).queryByRole("switch")).toBeNull();
});

it("u4463_the_hint_describes_the_switch_and_is_not_a_line", async () => {
  await open();
  const control = screen.getByRole("switch", { name: "Auto", description: copy.todoAutoHint });
  const description = document.getElementById(control.getAttribute("aria-describedby")!);

  expect(description?.hidden).toBe(true);
});
