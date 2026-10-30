import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "../App";
import { fakeEmulators } from "../terminal/paneHarness";
import { todoHandlers } from "../testing/stores";
import { todo } from "../todos/testHarness";
import type { ConnectedProject } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { agent, info, workstream } from "../testing/nodes";
import { leaderArmed, endLeader } from "./registry";

const draft = "  unfinished work 🐈\nexact  ";

const press = (code: string, options: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent("keydown", { code, key: code === "Slash" ? "/" : code.replace("Key", "").toLowerCase(), bubbles: true, cancelable: true, ...options });
  document.activeElement!.dispatchEvent(event);

  return event;
};

afterEach(() => { cleanup(); endLeader(); localStorage.clear(); });

const chords = ["agent", "prompt", "terminal", "capture", "leader", "ask", "help"] as const;

const places = ["rail", "centre", "agent-terminal", "bubble", "shelf", "triage", "ask", "first-control", "first-frame"] as const;

const rows = [
  ...chords.flatMap(chord => places.map(place => ({ chord, place, native: false, choose: false }))),
  ...places.map(place => ({ chord: "capture" as const, place, native: true, choose: place.startsWith("first") })),
  ...(["header", "drawer", "rename", "textarea", "select", "editable", "terminal-screen"] as const).map(place => ({ chord: "help" as const, place, native: false, choose: false })),
  ...(["first-control", "first-frame"] as const).map(place => ({ chord: "capture" as const, place, native: false, choose: true })),
];

it.each(rows)("u4324b_app_chords_follow_focus: $chord / $place / native=$native / choose=$choose", async ({ chord, place, native, choose }) => {
  const first = place.startsWith("first");
  const app = createFakeApp();

  if (!first) app.add("/p");
  app.chooser.path = choose ? "/chosen" : null;
  const nativeShow = vi.fn(async () => {});

  if (native) app.capture = {
    configure: async () => {}, show: nativeShow, dismiss: async () => {}, publish: async () => {}, act: async () => {},
    onRequested: async () => () => {}, onAction: async () => () => {}, onState: async () => () => {},
  };
  const nodes = [workstream("home"), agent("a1", "idle", "ready", { parent: "home" })];
  const shells = [info("existing", { owner: "home", title: "existing" })];
  app.handlers["rail.tree"] = () => nodes;
  app.handlers["terminal.list"] = () => [...shells, info("t-a1", { owner: "a1" })];
  app.handlers["terminal.snapshot"] = () => ({ cols: 80, rows: 24, after: 0, data: "" });
  app.handlers["terminal.resize"] = () => null;
  const store = { todos: [todo(1, { title: "Selected work", home: "home" })] };
  Object.assign(app.handlers, todoHandlers(store, () => {}));
  let connection: ConnectedProject | undefined;
  const connected = () => connection!;
  const emulators = fakeEmulators();
  const fixture = first ? null : { connected, store, shells };
  const chooser = vi.spyOn(app, "chooseProjectPath");
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} createEmulator={id => {
    const emulator = emulators.factory(id);
    const show = emulator.show;
    const bind = emulator.bind;

    emulator.bind = next => { bind?.(next); id = next; };

    emulator.show = (host, focus) => {
      const size = show(host, false);
      const input = document.createElement("textarea");
      input.dataset.terminal = id;
      host.replaceChildren(input);

      if (focus !== false) input.focus();
      emulator.focus = () => input.focus();

      return size;
    };

    return emulator;
  }} prepareIdle={open => { connection = open; }} />);

  if (!first) await screen.findByRole("textbox", { name: "Ask" });
  const daemon = app;
  const calls = (method: string) => daemon.calls.filter(call => call.method === method);
  daemon.handlers["agent.spawn"] = () => { const spawned = agent("new", "idle", "ready"); nodes.push(spawned);

 return spawned; };

  daemon.handlers["terminal.open"] = () => { shells.push(info("shell", { owner: "home" }));

 return { terminal_id: "shell" }; };

  let target: HTMLElement;

  if (first) {
    target = await screen.findByRole("button", { name: "Choose folder…" });

    if (place === "first-frame") target = document.querySelector<HTMLElement>(".centre")!;
  } else {
    const editor = screen.getByRole("textbox", { name: "Ask" });
    fireEvent.input(editor, { target: { value: draft } });
    fixture!.store.todos[0]!.home = "home";

    if (place !== "ask") fixture!.connected().rail.select("home");

    if (place === "agent-terminal" || place === "terminal-screen") {
      fixture!.connected().rail.select("a1");
      await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("t-a1"));
      target = document.querySelector<HTMLElement>(place === "terminal-screen" ? ".pane-screen" : '.pane-screen [data-terminal="t-a1"]')!;
    } else if (place === "bubble") {
      fireEvent.click(await screen.findByRole("button", { name: "existing" }));
      await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("existing"));
      target = document.querySelector<HTMLElement>('[data-terminal="existing"]')!;
    } else if (place === "shelf" || place === "triage" || place === "drawer") {
      press("KeyK", { metaKey: true }); press("KeyB");
      await waitFor(() => expect(document.querySelector('[data-shelf-group="unassigned"] [data-part="branch-control"]')).not.toBeNull());
      fireEvent.click(document.querySelector('[data-shelf-group="unassigned"] [data-part="branch-control"]')!);

      if (place === "triage") fireEvent.click(await screen.findByRole("button", { name: "Triage" }));
      await waitFor(() => expect(document.querySelector(".todo-row-button")).not.toBeNull());
      target = document.querySelector<HTMLElement>(".todo-row-button")!;

      if (place === "drawer") {
        target.focus();
        fireEvent.keyDown(target, { key: "Enter", code: "Enter" });
        await waitFor(() => expect(document.querySelector(".drawer[data-open=true] button")).not.toBeNull());
        target = document.querySelector<HTMLElement>(".drawer[data-open=true] button")!;
      }
    } else if (place === "rename") {
      const row = document.querySelector<HTMLElement>('.rail-row[data-id="home"]')!;
      row.focus();
      fireEvent.keyDown(row, { key: "F2", code: "F2" });
      await waitFor(() => expect(document.querySelector(".rail-row input")).not.toBeNull());
      target = document.querySelector<HTMLElement>(".rail-row input")!;
    } else if (["textarea", "select", "editable"].includes(place)) {
      target = document.createElement(place === "editable" ? "div" : place);

      if (place === "editable") {
        target.setAttribute("contenteditable", "true");
        const child = target.appendChild(document.createElement("span"));
        child.tabIndex = 0;
        document.querySelector(".centre")!.appendChild(target);
        target = child;
      } else document.querySelector(".centre")!.appendChild(target);
    } else if (place === "header") target = screen.getByRole("tab", { name: "p" });
    else target = place === "ask" ? editor : document.querySelector<HTMLElement>(place === "rail" ? '.rail-row[data-id="home"]' : ".centre")!;
  }

  target.tabIndex = -1;
  target.focus();
  expect(document.activeElement).toBe(target);
  const selected = fixture?.connected().rail.selected();
  const shelfBefore = document.querySelector(".window")?.getAttribute("data-shelf");
  const original = fixture?.connected().drafts.list().find(record => record.destination.surface === "ask" && record.value.text === draft);
  const received = vi.fn();
  target.addEventListener("keydown", received);

  const event = chord === "help" ? press("Slash", { key: "?", shiftKey: true })
    : chord === "ask" ? press("Slash", { metaKey: true })
    : chord === "leader" ? press("KeyK", { metaKey: true })
    : press(chord === "agent" || chord === "prompt" ? "KeyN" : "KeyT", { metaKey: true, shiftKey: chord === "prompt" || chord === "capture" });

  const excludedHelp = chord === "help" && ["agent-terminal", "bubble", "ask", "terminal-screen", "rename", "textarea", "select", "editable"].includes(place);

  if (chord === "help") {
    if (excludedHelp) { expect(event.defaultPrevented).toBe(false); expect(screen.queryByRole("dialog")).toBeNull(); }
    else {
      await screen.findByRole("dialog", { name: "Help" });
      await waitFor(() => expect(document.activeElement).toBe(document.querySelector(".help")));
      press("Escape", { key: "Escape" });
      await waitFor(() => expect(document.activeElement).toBe(target));
      expect(fixture?.connected().rail.selected()).toBe(selected);
    }
  } else if (first) {
    if (chord === "capture") {
      await waitFor(() => expect(chooser).toHaveBeenCalledTimes(1));

      if (choose) {
        if (native) await waitFor(() => expect(nativeShow).toHaveBeenCalledTimes(1));
        else await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Capture a Todo" })));
      }

      expect(calls("todo.create")).toHaveLength(0);
    }

    expect(calls("agent.spawn")).toHaveLength(0);
    expect(calls("terminal.open")).toHaveLength(0);
    expect(leaderArmed()).toBe(false);

    if (!choose || native) expect(screen.queryByRole("dialog")).toBeNull();
  } else if (chord === "agent") {
    await waitFor(() => expect(calls("agent.spawn")).toHaveLength(1));
    expect(calls("agent.spawn")[0]?.params).toMatchObject({ cwd: "/p", parent: place === "ask" || place === "agent-terminal" ? null : "home" });
  } else if (chord === "terminal") {
    await waitFor(() => expect(calls("terminal.open")).toHaveLength(1));
    expect(calls("terminal.open")[0]?.params).toEqual({ workstream: "home", cols: 100, rows: 30 });
    await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("shell"));
  }
  else if (chord === "capture" && native) {
    await waitFor(() => expect(nativeShow).toHaveBeenCalledTimes(1));
    press("KeyT", { metaKey: true, shiftKey: true, repeat: true });
    expect(nativeShow).toHaveBeenCalledTimes(1);
    expect(calls("todo.create")).toHaveLength(0);
  } else if (chord === "prompt" || chord === "capture") {
    const field = await screen.findByRole("textbox", { name: chord === "capture" ? "Capture a Todo" : "Task" });
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(calls("agent.spawn")).toHaveLength(0);
    expect(calls("todo.create")).toHaveLength(0);

    if (chord === "capture") {
      press("KeyT", { metaKey: true, shiftKey: true, repeat: true });
      expect(document.activeElement).toBe(field);
      expect(fixture!.connected().rail.selected()).toBe(selected);
    }
  } else if (chord === "leader") {
    expect(leaderArmed()).toBe(true);
    expect(document.activeElement).toBe(target);
    press("KeyB");
    expect(leaderArmed()).toBe(false);
    expect(document.querySelector(".window")?.getAttribute("data-shelf")).not.toBe(shelfBefore);
  } else await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Ask" })));

  if (!first && !excludedHelp) expect(event.defaultPrevented).toBe(true);

  if (event.defaultPrevented) expect(received).not.toHaveBeenCalled();
  expect(calls("terminal.write")).toHaveLength(0);
  expect(calls("ask.send")).toHaveLength(0);

  if (fixture) expect(fixture.connected().drafts.list().find(record => record.revision === original?.revision)).toEqual(original);
});
