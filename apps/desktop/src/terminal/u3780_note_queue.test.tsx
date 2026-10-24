import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { node, info } from "../testing/nodes";
import { mountSwitcher, openSwitcher, field, switcherKey, rows } from "../switcher/switcherFixture";
import { callsTo } from "./paneHarness";
import { mountNotes, note, rowsOf, sent } from "./noteQueueHarness";

afterEach(cleanup);

const AGENTS = [node("a", { name: "Ann" }), node("b", { name: "Bo" })];

const TERMINALS = [info("t-a"), info("t-b")];

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

it("b3563b_pending_messages_stay_in_the_selected_queue", async () => {
  const { app, connected, container } = await mountNotes(AGENTS, TERMINALS, [
    note(3, "third\nwith more", { from: { kind: "agent", id: "b", parent: null } }),
    note(1, "first"),
    note(2, "taken", { status: "delivered" }),
    note(4, "to Bo", { to: "b" }),
  ]);

  connected.rail.select("a");
  await waitFor(() => expect(rowsOf()).toEqual(["first", "third…"]));
  expect(container.querySelector('[data-note="3"]')?.getAttribute("aria-description")).toBe("third\nwith more");
  expect(container.querySelector('[data-note="3"] [data-remove]')).toBeNull();
  expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();

  app.emit(sent(note(5, "fifth")));
  await waitFor(() => expect(rowsOf()).toEqual(["first", "third…", "fifth"]));
  app.emit(sent(note(1, "first", { status: "delivered" })));
  await waitFor(() => expect(rowsOf()).toEqual(["third…", "fifth"]));

  connected.rail.select("b");
  await waitFor(() => expect(rowsOf()).toEqual(["to Bo"]));
  connected.rail.select("a");
  await waitFor(() => expect(rowsOf()).toEqual(["third…", "fifth"]));

  app.emit(sent(note(3, "third\nwith more", { status: "delivered" })));
  app.emit(sent(note(5, "fifth", { status: "delivered" })));
  await waitFor(() => expect(container.querySelector(".note-queue")).toBeNull());
});

it("u3787_the_agent_pane_has_no_textarea_outside_the_terminal", async () => {
  for (const messages of [[], [note(1, "for Ann"), note(2, "for Bo", { to: "b" })]]) {
    const { app, connected, container } = await mountNotes(AGENTS, TERMINALS, messages);

    for (const id of ["a", "b", "a"]) {
      connected.rail.select(id);
      await waitFor(() => expect(container.querySelector(`.pane-screen [data-terminal="t-${id}"]`)).toBeTruthy());
      await waitFor(() => expect(app.calls).toContainEqual({ method: "message.list", params: { to: id, status: null } }));
      await waitFor(() => expect(rowsOf()).toEqual(messages.filter(message => message.to === id).map(message => message.body)));

      const pane = container.querySelector(".pane")!;

      expect([...pane.querySelectorAll("textarea")].filter(field => !field.closest(".pane-screen"))).toEqual([]);
    }

    cleanup();
  }
});
