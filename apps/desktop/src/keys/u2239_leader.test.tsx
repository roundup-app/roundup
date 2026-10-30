import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openTabs, projectTabs, rowSelected, tab } from "../header/stripFixture";
import { agent } from "../testing/nodes";
import { callsTo } from "../terminal/paneHarness";
import { Leader } from "./Leader";
import { leaderArmed, registerKeys } from "./registry";
import { ConnectedProjectContext, connectProject } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const key = (code: string, init: KeyboardEventInit = {}, target: EventTarget = document.body): KeyboardEvent => {
  const press = new KeyboardEvent("keydown", { code, key: code.replace(/^Key/, "").toLowerCase(), bubbles: true, cancelable: true, ...init });

  target.dispatchEvent(press);

  return press;
};

const arm = (): KeyboardEvent => key("KeyK", { metaKey: true });

const open = () => openTabs({ api: [agent("a1", "needs-you", "x"), agent("a2", "idle", "x")], web: [agent("w1", "needs-you", "x")] });

const active = (): string | undefined => projectTabs().find((entry) => entry.getAttribute("aria-selected") === "true")?.textContent?.replace(/[⊗◉]/, "");

const shelf = (): string | undefined => document.querySelector<HTMLElement>(".window")?.dataset["shelf"];

describe("u2239 the leader takes the next key", () => {
  it("u2239_each_leader_key_runs_its_action_once", async () => {
    await open();

    expect(arm().defaultPrevented).toBe(true);
    expect(leaderArmed()).toBe(true);
    expect(key("KeyJ").defaultPrevented).toBe(true);
    expect(leaderArmed()).toBe(false);
    expect(rowSelected("w1")).toBe("true");

    arm();
    key("KeyJ", { shiftKey: true });
    await waitFor(() => expect(projectTabs().find(entry => entry.getAttribute("aria-selected") === "true")).toBe(tab("api")));

    arm();
    key("KeyK");
    await waitFor(() => expect(document.querySelector(".switcher input")).not.toBeNull());
    key("Escape", {}, document.querySelector(".switcher input")!);
    await waitFor(() => expect(document.querySelector(".switcher input")).toBeNull());

    const before = shelf();

    arm();
    key("KeyB");
    await waitFor(() => expect(shelf()).not.toBe(before));

    const kept = key("KeyB", { repeat: true });

    expect(kept.defaultPrevented).toBe(true);
    expect(shelf()).not.toBe(before);
  });

  it("u2239_the_leader_waits_without_a_timeout", async () => {
    await open();
    vi.useFakeTimers();
    arm();
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(leaderArmed()).toBe(true);
    key("KeyJ");
    expect(rowSelected("w1")).toBe("true");
  });

  it("u2239_escape_and_an_unbound_key_end_the_wait_and_reach_nothing", async () => {
    const { app } = await open();

    const terminal = document.body.appendChild(document.createElement("textarea"));
    const reached: KeyboardEvent[] = [];

    terminal.addEventListener("keydown", (press) => reached.push(press));
    terminal.focus();

    const calls = app.of("/Users/me/web").calls.length;
    const beforeShelf = shelf();

    for (const [code, init] of [["Escape", {}], ["KeyJ", { metaKey: true }], ["KeyJ", { altKey: true }], ["KeyJ", { ctrlKey: true }], ["Enter", {}], ["Tab", {}], ["Digit1", {}], ["KeyX", {}], ["KeyS", {}]] as const) {
      arm();
      expect(key(code, init, terminal).defaultPrevented).toBe(true);
      expect(leaderArmed()).toBe(false);
      expect(shelf()).toBe(beforeShelf);
    }

    expect(reached).toEqual([]);
    expect(callsTo(app.of("/Users/me/web"), "terminal.write")).toEqual([]);
    expect(app.of("/Users/me/web").calls.length).toBe(calls);

    expect(key("KeyJ", {}, terminal).defaultPrevented).toBe(false);
    expect(reached).toHaveLength(1);
  });

  it("u2239_a_modifier_alone_keeps_the_wait", async () => {
    await open();
    arm();
    key("ShiftLeft", { key: "Shift", shiftKey: true });
    key("MetaLeft", { key: "Meta", metaKey: true });
    expect(leaderArmed()).toBe(true);
    key("KeyJ", { shiftKey: true });
    expect(leaderArmed()).toBe(false);
    await waitFor(() => expect(active()).toBe("api"));
  });

  it("u2239_pointer_press_project_switch_and_modal_end_the_wait", async () => {
    await open();
    arm();
    fireEvent.pointerDown(document.body);
    expect(leaderArmed()).toBe(false);

    arm();
    fireEvent.click(tab("api"));
    await waitFor(() => expect(active()).toBe("api"));
    expect(leaderArmed()).toBe(false);

    cleanup();

    const [modal, setModal] = createSignal(false);
    const connected = await connectProject(createFakeApp(), { name: "p", path: "/p" }, () => false, () => 0, () => null);

    render(() => {
      registerKeys({ kind: "layer", element: () => undefined, active: modal, modal: true }, []);

      return <ConnectedProjectContext.Provider value={connected}><Leader /></ConnectedProjectContext.Provider>;
    });
    arm();
    expect(leaderArmed()).toBe(true);
    setModal(true);
    expect(leaderArmed()).toBe(false);
    arm();
    expect(leaderArmed()).toBe(false);
  });

  it("u2240_the_panel_lists_the_table_and_follows_the_wait", async () => {
    await open();
    const focus = document.activeElement;

    expect(document.querySelector(".leader")).toBeNull();
    arm();

    const panel = document.querySelector(".hint-line.leader")!;

    expect(document.activeElement).toBe(focus);
    expect(panel.querySelectorAll("button:enabled").length).toBeGreaterThan(0);
    key("Escape");
    expect(document.querySelector(".leader")).toBeNull();
  });
});
