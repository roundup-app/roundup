import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountNavigation } from "../testing/navigationFixture";
import { railCallsTo } from "./railFixture";

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); });

const slash = () => fireEvent.keyDown(document.body, { key: "/", code: "Slash", metaKey: true });

it("u6244a_rail_has_no_overview_row", async () => {
  const { connected } = await mountNavigation();
  expect(screen.queryByRole("button", { name: /^Overview/ })).toBeNull();
  expect(document.querySelector(".rail [data-todo-root]")).toBeNull();

  connected().rail.select("a1");
  await waitFor(() => expect(document.querySelector<HTMLElement>('.rail-row[data-id="a1"]')?.dataset.selected).toBe("true"));
  expect(screen.queryByRole("button", { name: /Overview|waiting/ })).toBeNull();
});

it("u6244b_nothing_selected_shows_one_empty_view", async () => {
  const { app } = await mountNavigation();
  const empty = screen.getByRole("group", { name: "Nothing selected" });
  expect(within(empty).getAllByRole("button").map(button => button.getAttribute("aria-label"))).toEqual(["New Agent", "Ask"]);
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(document.querySelector(".centre .change-list, .centre .project-overview")).toBeNull();

  fireEvent.click(within(empty).getByRole("button", { name: "New Agent" }));
  await waitFor(() => expect(railCallsTo(app, "agent.spawn")).toHaveLength(1));

  fireEvent.click(within(empty).getByRole("button", { name: "Ask" }));
  expect(await screen.findByRole("textbox")).not.toBeNull();
  expect(railCallsTo(app, "agent.spawn")).toHaveLength(1);
});

it("u6244c_ask_opens_only_by_its_shortcut", async () => {
  const { connected } = await mountNavigation();
  expect(screen.queryByRole("textbox")).toBeNull();

  for (const selected of [null, "a1"]) {
    connected().rail.select(selected);
    await waitFor(() => expect(connected().rail.selected()).toBe(selected));
    const before = document.querySelector<HTMLElement>(selected === null ? ".rail-row" : `.rail-row[data-id="${selected}"]`)!;
    before.focus();
    slash();
    const field = await screen.findByRole("textbox");
    await waitFor(() => expect(document.activeElement).toBe(field));

    fireEvent.keyDown(field, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(before));
  }
});
