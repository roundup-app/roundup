import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountSwitcher, openSwitcher, field, switcherKey, rows } from "../switcher/switcherFixture";
import { callsTo } from "./paneHarness";

afterEach(cleanup);

const base64 = (text: string): string => btoa(text);

const pick = async (name: string) => {
  openSwitcher();
  await waitFor(() => expect(field()).not.toBeNull());
  fireEvent.input(field()!, { target: { value: name } });
  await waitFor(() => expect(rows()).toEqual([name]));
  switcherKey("Enter", {}, field()!);
};

it("b3563a_direct_input_needs_only_terminal_focus", async () => {
  const { app, connected, emulators } = await mountSwitcher();
  const type = (id: string, text: string) => emulators.made.get(id)?.type(new TextEncoder().encode(text));

  // By pointer: a click on the Agent's row selects it, and its Terminal takes the typing at once.
  fireEvent.click(document.querySelector('[role="treeitem"][data-id="ann"]')!);
  await waitFor(() => expect(document.querySelector('.pane-screen [data-terminal="t-ann"]')).not.toBeNull());
  document.querySelector<HTMLElement>('.pane-screen [data-terminal="t-ann"]')!.focus();
  type("t-ann", "x");
  await waitFor(() => expect(callsTo(app, "terminal.write")).toEqual([{ id: "t-ann", data: base64("x") }]));

  // By keyboard: the switcher selects another Agent and focuses its Terminal; typing reaches that one only.
  await pick("Dee");
  await waitFor(() => expect(connected.rail.selected()).toBe("dee"));
  await waitFor(() => expect(document.activeElement?.closest(".pane-screen")?.querySelector('[data-terminal="t-dee"]')).not.toBeNull());
  type("t-dee", "y");
  await waitFor(() => expect(callsTo(app, "terminal.write")).toHaveLength(2));

  // Back to the first Agent: selection survives, and a chord the Terminal owns is left alone.
  await pick("Ann");
  await waitFor(() => expect(connected.rail.selected()).toBe("ann"));
  await waitFor(() => expect(document.activeElement?.closest(".pane-screen")?.querySelector('[data-terminal="t-ann"]')).not.toBeNull());
  expect(switcherKey("Enter", { metaKey: true }, document.activeElement!).defaultPrevented).toBe(false);
  type("t-ann", "z");

  await waitFor(() => expect(callsTo(app, "terminal.write")).toEqual([
    { id: "t-ann", data: base64("x") }, { id: "t-dee", data: base64("y") }, { id: "t-ann", data: base64("z") },
  ]));
  expect(screen.queryByRole("button", { name: /control/i })).toBeNull();
});
