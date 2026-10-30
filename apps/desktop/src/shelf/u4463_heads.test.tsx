import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { Shelf } from "./Shelf";
import { Tabs } from "../ui/Tabs";
import { seedApp } from "../testing/seeds";
import { copy } from "../copy";

afterEach(() => { cleanup(); localStorage.clear(); });

const open = async () => {
  const connected = await connectProject(seedApp("tree-40", 0).app, {name: "harness", path: "/Users/you/harness"}, () => true, () => 0);
  await connected.rail.settled();
  connected.rail.select("backend");
  render(() => <ConnectedProjectContext.Provider value={connected}>
    <Tabs.Root defaultValue="todos">
      <Tabs.List aria-label="Bench"><Tabs.Trigger value="todos">Todos</Tabs.Trigger><Tabs.Trigger value="pads">Pads</Tabs.Trigger></Tabs.List>
      <Shelf open={() => true} />
    </Tabs.Root>
  </ConnectedProjectContext.Provider>);
  await waitFor(() => expect(document.querySelector('[data-shelf-scope] [role="switch"]')).not.toBeNull());
};

it("u4463_each_head_is_one_row_of_title_and_controls", async () => {
  await open();
  const head = document.querySelector<HTMLElement>("[data-shelf-scope]")!;

  expect(within(head).getAllByRole("switch")).toHaveLength(1);
  expect(within(head).getAllByRole("button").map(button => button.getAttribute("aria-label"))).toEqual(["add todo to backend", "Triage"]);
  fireEvent.click(within(screen.getByRole("tablist", { name: "Bench" })).getByRole("tab", { name: /^Pads/ }));
  await waitFor(() => expect(within(head).getByRole("button", { name: copy.addPad })).toBeTruthy());
  expect(within(head).queryByRole("switch")).toBeNull();
});

it("u4463_the_hint_describes_the_switch_and_is_not_a_line", async () => {
  await open();
  const control = within(document.querySelector<HTMLElement>("[data-shelf-scope]")!).getByRole("switch", { name: "Auto", description: copy.todoAutoHint });
  const description = document.getElementById(control.getAttribute("aria-describedby")!);

  expect(description?.hidden).toBe(true);
});
