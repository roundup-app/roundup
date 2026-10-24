import { cleanup, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { mountCentre } from "../testing/centreFixture";
import { agent, door, workstream } from "../testing/nodes";

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

  it("u467_a_late_snapshot_cannot_replace_the_selected_door", async () => {
    let release: () => void = () => {};

    const kept = new Promise<void>((resolve) => { release = resolve; });

    const { app, connected, emulators } = await mountCentre(tree(), {
      select: null,
      prepare: (fake) => {
        fake.handlers["terminal.snapshot"] = async (params) => {
          if (params.id === "t-w1") await kept;

          return { cols: 100, rows: 30, after: 0, data: params.id === "t-w1" ? "first door" : "second door" };
        };
      },
    });

    connected.rail.select("w1");
    await waitFor(() => expect(app.calls.some((call) => call.method === "terminal.snapshot")).toBe(true));
    connected.rail.select("w2");
    await waitFor(() => expect(emulators.get("t-w2")?.written.length).toBeGreaterThan(0));
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect([screens(), emulators.get("t-w1")?.written.length ?? 0]).toEqual([["t-w2"], 0]);
  });

  it("u467_a_missing_door_has_an_actionable_state_and_no_input_target", async () => {
    const { app } = await mountCentre([workstream("w1")]);

    expect([await screen.findByText("Supervisor not started"), screens(), app.calls.filter((call) => call.method === "terminal.write")]).toEqual([expect.anything(), [], []]);
  });
});
