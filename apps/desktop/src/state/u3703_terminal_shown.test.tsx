import { cleanup } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agent, door, event, info } from "../testing/nodes";
import { mountCentre } from "../testing/centreFixture";

const tree = () => [door("workstream", "idle", "idle", { name: "lead" }), agent("a", "working", "x", { parent: "workstream", name: "ann", terminal_id: "t-a" })];

const mount = () => mountCentre(tree(), {
  select: "workstream",
  prepare: (app) => {
    app.handlers["terminal.list"] = () => [info("t-workstream"), info("t-a"), info("9", { owner: "a" }), info("8", { owner: "gone" })];
  },
});

const shown = (id: string) => event({ name: "terminal.shown", data: { id } });

const centre = () => document.querySelector(".centre [data-terminal]")?.getAttribute("data-terminal");

afterEach(cleanup);

describe("u3703 the App shows a Terminal the Daemon names", () => {
  it("u3703_terminal_shown_selects_the_owner", async () => {
    const { app, connected } = await mount();

    app.emit(shown("t-a"));
    await vi.waitFor(() => expect(connected.rail.selected()).toBe("a"));
    await vi.waitFor(() => expect(centre()).toBe("t-a"));

    connected.rail.select("workstream");
    app.emit(shown("9"));
    await vi.waitFor(() => expect(connected.rail.selected()).toBe("a"));
  });

  it("u3703_terminal_shown_only_selects", async () => {
    const { app, connected } = await mount();
    const before = app.calls.length;

    app.emit(shown("t-a"));
    await vi.waitFor(() => expect(connected.rail.selected()).toBe("a"));

    expect(app.calls.slice(before).map((call) => call.method).filter((method) => /^(terminal\.(write|spawn|open)|takeover\.|rail\.startDoor)/.test(method))).toEqual([]);
  });

  it("u3703_an_unknown_terminal_id_changes_nothing", async () => {
    const { app, connected } = await mount();

    app.emit(shown("nope"));
    app.emit(shown("8"));
    await connected.rail.settled();

    expect(connected.rail.selected()).toBe("workstream");
    expect(document.querySelector("[role=alert]")).toBeNull();
  });

  it("u3703_a_repeat_event_keeps_the_selection", async () => {
    const { app, connected } = await mount();

    app.emit(shown("t-a"));
    await vi.waitFor(() => expect(connected.rail.selected()).toBe("a"));
    const focus = document.activeElement;
    app.emit(shown("t-a"));
    await connected.rail.settled();

    expect(connected.rail.selected()).toBe("a");
    expect(document.activeElement).toBe(focus);
  });
});
