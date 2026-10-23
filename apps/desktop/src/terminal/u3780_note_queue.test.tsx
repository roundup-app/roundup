import { cleanup, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { node, info } from "../testing/nodes";
import { mountNotes, note, rowsOf, sent } from "./noteQueueHarness";

afterEach(cleanup);

const AGENTS = [node("a", { name: "Ann" }), node("b", { name: "Bo" })];

const TERMINALS = [info("t-a"), info("t-b")];

it("u3780_the_queue_is_the_agents_waiting_messages_in_order", async () => {
  const { app, connected, container } = await mountNotes(AGENTS, TERMINALS, [
    note(3, "third\nwith more", { status: "held", reason: "takeover" }),
    note(1, "first"),
    note(2, "taken", { status: "delivered" }),
    note(4, "to Bo", { to: "b" }),
  ]);

  connected.rail.select("a");
  await waitFor(() => expect(rowsOf()).toEqual(["first", "third…"]));
  expect(container.querySelector('[data-note="3"]')?.getAttribute("aria-description")).toBe("third\nwith more");
  expect(screen.getByText("2 waiting")).toBeTruthy();

  app.emit(sent(note(5, "fifth")));
  await waitFor(() => expect(rowsOf()).toHaveLength(3));
  app.emit(sent(note(1, "first", { status: "dropped", reason: "removed" })));
  await waitFor(() => expect(rowsOf()).toEqual(["third…", "fifth"]));
});

it("u3780_an_empty_queue_draws_nothing", async () => {
  const { connected, container } = await mountNotes(AGENTS, TERMINALS);

  connected.rail.select("a");
  await screen.findByText("t-a");

  expect(container.querySelector(".note-queue")).toBeNull();
});

it("u3780_two_agents_never_share_a_queue", async () => {
  const { connected } = await mountNotes(AGENTS, TERMINALS, [note(1, "for Ann"), note(2, "for Bo", { to: "b" })]);

  connected.rail.select("a");
  await waitFor(() => expect(rowsOf()).toEqual(["for Ann"]));

  connected.rail.select("b");
  await waitFor(() => expect(rowsOf()).toEqual(["for Bo"]));
  connected.rail.select("a");
  await waitFor(() => expect(rowsOf()).toEqual(["for Ann"]));
  expect(within(document.body).queryByText("for Bo")).toBeNull();
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
