import { cleanup, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { mountCentre } from "../testing/centreFixture";
import { agent, door } from "../testing/nodes";

afterEach(cleanup);

const tree = () => [
  door("w1", "idle", "idle", { name: "one" }),
  door("w2", "idle", "idle", { name: "two" }),
  agent("c1", "working", "x", { parent: "w1", name: "child" }),
];

const screens = () => [...document.querySelectorAll<HTMLElement>("[data-terminal]")].map((screen) => screen.dataset.terminal);

describe("u467 a Workstream shows its Door's Terminal", () => {
  it("u467_workstream_selection_focuses_its_own_door", async () => {
    const { connected } = await mountCentre(tree());

    connected.rail.select("w2");

    await waitFor(() => expect((document.activeElement instanceof HTMLElement ? document.activeElement.dataset.terminal : null)).toBe("t-w2"));
  });

  it("u467_typed_input_reaches_only_the_selected_terminal", async () => {
    const { app, connected, emulators } = await mountCentre(tree());

    connected.rail.select("w1");
    await waitFor(() => expect(emulators.get("t-w1")).toBeDefined());
    emulators.get("t-w1")!.type(new TextEncoder().encode("x"));

    await waitFor(() => expect(app.calls.filter((call) => call.method === "terminal.write").map((call) => Object.entries(call.params ?? {}).find(([key]) => key === "id")?.[1])).toEqual(["t-w1"]));
  });

  it("u467_removed_surfaces_are_absent", async () => {
    await mountCentre(tree());

    expect([".thread-feed", ".thread-composer", ".thread-header", ".digest", '[data-thread]'].filter((selector) => document.querySelector(selector) !== null)).toEqual([]);
  });

  it("u467_switching_keeps_each_door_and_its_output", async () => {
    const { connected, emulators } = await mountCentre(tree());

    connected.rail.select("w1");
    await waitFor(() => expect(emulators.get("t-w1")).toBeDefined());
    connected.rail.select("w2");
    await waitFor(() => expect(screens()).toEqual(["t-w2"]));
    connected.rail.select("w1");

    await waitFor(() => expect(screens()).toEqual(["t-w1"]));
    expect(emulators.get("t-w1")!.disposed).toBe(false);
  });
});
