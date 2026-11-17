import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { RequestedApp as App } from "../testing/requestedApp";
import { createFakeApp } from "../testing/fakeApp";
import { agent, door } from "../testing/nodes";
import type { RailNode } from "@contracts/agent/RailNode";
import type { ConnectedProject } from "../state/connectedProject";
import type { OpenRequest } from "../window/nativeOpen";
import { walkSteps } from "./walkSteps";

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks(); });

const KEY = "project-0000000000000000";

const TEXT = (n: number) => Array.from({ length: n }, (_, i) => `# Part ${i + 1}\nBody ${i + 1}`).join("\n\n");

/** A Project "/project" holding `nodes` (Agent `chosen` by default) and the Pads `notes` and `plan` (3 steps each) unless `pads` gives other text; `click` is a plain click on a walk link of a Pad, from a Terminal. */
const mount = async ({ pads: texts = {}, nodes = [agent("chosen", "idle", "ready")] }: { pads?: Record<string, string>; nodes?: RailNode[] } = {}) => {
  const app = createFakeApp();
  app.add("/project");
  const pads = new Map([["notes", TEXT(3)], ["plan", TEXT(3)], ...Object.entries(texts)]);
  app.handlers["rail.tree"] = () => nodes;
  app.handlers["terminal.list"] = () => [];
  // SAFETY: the Message reply is unread.
  app.handlers["message.send"] = () => ({}) as never;
  app.handlers["link.read"] = params => {
    // SAFETY: link.read params always carry the url.
    const name = decodeURIComponent(new URL((params as { url: string }).url).pathname.slice(1));
    const text = pads.get(name);

    if (text === undefined) throw new Error(`not found: pad ${name}`);

    // SAFETY: the walk reads only `pad.text`.
    return { kind: "pad", id: name, pad: { name, text }, section: null } as never;
  };

  let receive: ((request: OpenRequest) => void) | undefined;


  // SAFETY: the App's listener takes an OpenRequest, a NativeOpen that may carry a surface.
  app.onNativeOpen = listener => {
    // SAFETY: every request the listener gets is an OpenRequest.
    receive = listener as typeof receive;

    return () => {};
  };

  let connected: ConnectedProject | undefined;
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} prepareIdle={open => { connected = open; }} />);
  await waitFor(() => expect(connected).toBeDefined());
  await waitFor(() => expect(receive).toBeDefined());

  if (connected === undefined || receive === undefined) throw new Error("the App did not connect");

  const open = receive;
  const project = connected;

  /** A plain click on a walk link of `pad`; with `terminal`, the click lands in that Terminal, which holds focus. */
  const click = (pad: string, terminal?: string) => {
    if (terminal !== undefined) {
      const screen = document.body.appendChild(document.createElement("div"));
      screen.dataset.terminal = terminal;
      screen.tabIndex = 0;
      screen.focus();
    }

    open({ kind: "link", url: `roundup://walk/${pad}?project=${KEY}`, surface: "/project" });
  };

  // SAFETY: message.send params always carry `to` and `body`.
  return { app, connected: project, click, messages: () => app.calls.filter(call => call.method === "message.send").map(call => call.params as { to: string; body: string }) };
};

const walkEl = () => document.querySelector<HTMLElement>("[data-walk]");

/** The open walk, once it shows. */
const shown = () => waitFor(() => {
  const found = walkEl();

  if (!found) throw new Error("no walk is open");

  return found;
});

/** The step the open walk shows, of its steps. */
const step = async () => {
  const walk = await shown();

  return [Number(walk.dataset.step), Number(walk.dataset.steps)];
};

it("pw1_a_pad_splits_into_steps_by_top_level_heading", () => {
  expect(walkSteps("intro\n# A\none\n## sub\n# B\ntwo", "p").map(s => [s.title, s.text])).toEqual([["A", "intro\n\none\n## sub"], ["B", "two"]]);
  expect(walkSteps("# A\n```\n# not a heading\n```\n~~~\n# nor this\n~~~\n# B", "p").map(s => s.title)).toEqual(["A", "B"]);
  expect(walkSteps("just text\n## deeper", "p")).toEqual([{ title: "p", text: "just text\n## deeper" }]);
});

it("pw2_one_click_on_a_walk_link_opens_step_1", async () => {
  const m = await mount();
  m.click("notes");
  expect(await step()).toEqual([1, 3]);
  expect(m.app.calls.filter(call => call.method === "link.read").map(call => call.params)).toEqual([{ url: `roundup://walk/notes?project=${KEY}` }]);
});

it("pw2_a_walk_link_of_a_missing_pad_opens_no_walk", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const m = await mount();
  m.click("gone");
  await waitFor(() => expect(m.app.calls.some(call => call.method === "link.read")).toBe(true));
  expect(walkEl()).toBeNull();
});

it("pw3_keys_and_buttons_move_one_step", async () => {
  const m = await mount();
  m.click("notes");
  const walk = await shown();
  fireEvent.keyDown(walk, { key: "ArrowLeft" });
  expect(await step()).toEqual([1, 3]);
  fireEvent.keyDown(walk, { key: "ArrowRight" });
  expect(await step()).toEqual([2, 3]);
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(await step()).toEqual([3, 3]);
  fireEvent.keyDown(walk, { key: "ArrowRight" });
  expect(await step()).toEqual([3, 3]);
  fireEvent.keyDown(walk, { key: "ArrowLeft" });
  expect(await step()).toEqual([2, 3]);
  screen.getByRole("button", { name: "Back" }).focus();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(await step()).toEqual([1, 3]);
  await waitFor(() => expect(document.activeElement).toBe(walk));
  expect(m.messages()).toEqual([]);
});

it("pw4_the_step_survives_a_restart_per_pad", async () => {
  const first = await mount();
  first.click("notes");
  fireEvent.click(await screen.findByRole("button", { name: "Next" }));
  fireEvent.click(await screen.findByRole("button", { name: "Next" }));
  expect(await step()).toEqual([3, 3]);
  cleanup();
  const second = await mount();
  second.click("plan");
  fireEvent.click(await screen.findByRole("button", { name: "Next" }));
  expect(await step()).toEqual([2, 3]);
  cleanup();

  const third = await mount();
  third.click("notes");
  expect(await step()).toEqual([3, 3]);
  cleanup();

  const fourth = await mount();
  fourth.click("plan");
  expect(await step()).toEqual([2, 3]);
  fireEvent.click(await screen.findByRole("button", { name: "Next" }));
  fireEvent.click(await screen.findByRole("button", { name: "Finish" }));
  await waitFor(() => expect(walkEl()).toBeNull());
  cleanup();

  const fifth = await mount();
  fifth.click("plan");
  expect(await step()).toEqual([1, 3]);
  cleanup();

  const shrunk = await mount({ pads: { notes: TEXT(2) } });
  shrunk.click("notes");
  expect(await step()).toEqual([2, 2]);
});

it("pw5_finish_focuses_the_senders_terminal_and_sends_one_message", async () => {
  const m = await mount();
  m.click("notes", "t-chosen");
  const walk = await shown();
  fireEvent.keyDown(walk, { key: "ArrowRight" });
  fireEvent.keyDown(walk, { key: "ArrowRight" });
  expect(await step()).toEqual([3, 3]);
  fireEvent.click(screen.getByRole("button", { name: "Finish" }));
  await waitFor(() => expect(m.connected.rail.selected()).toBe("chosen"));
  expect(m.messages().map(message => message.to)).toEqual(["chosen"]);
  expect(m.messages()[0]?.body).toContain(`roundup://walk/notes?project=${KEY}`);
  await waitFor(() => expect(walkEl()).toBeNull());

  m.click("notes", "t-chosen");
  const again = await shown();
  fireEvent.keyDown(again, { key: "ArrowRight" });
  fireEvent.keyDown(again, { key: "ArrowRight" });
  fireEvent.keyDown(again, { key: "Enter" });
  await waitFor(() => expect(m.messages()).toHaveLength(2));
});

it("pw5_a_walk_from_the_doors_terminal_finishes_there", async () => {
  const m = await mount({ nodes: [door("door", "idle", "ready")] });
  m.click("notes", "t-door");
  const walk = await shown();
  fireEvent.keyDown(walk, { key: "ArrowRight" });
  fireEvent.keyDown(walk, { key: "ArrowRight" });
  fireEvent.keyDown(walk, { key: "Enter" });
  await waitFor(() => expect(m.connected.rail.selected()).toBe("door"));
  expect(m.messages().map(message => message.to)).toEqual(["door"]);
});

it("pw5_a_walk_opened_without_a_link_returns_focus_and_sends_nothing", async () => {
  const m = await mount();
  const before = document.body.appendChild(document.createElement("button"));
  before.focus();
  m.click("notes");
  const walk = await shown();
  fireEvent.keyDown(walk, { key: "ArrowRight" });
  fireEvent.keyDown(walk, { key: "ArrowRight" });
  fireEvent.keyDown(walk, { key: "Enter" });
  await waitFor(() => expect(walkEl()).toBeNull());
  expect(m.messages()).toEqual([]);
  await waitFor(() => expect(document.activeElement).toBe(before));
});

it("pw7_finish_with_the_sender_gone_returns_focus_and_sends_nothing", async () => {
  const nodes = [agent("chosen", "idle", "ready"), agent("other", "idle", "ready")];
  const m = await mount({ nodes });
  m.click("notes", "t-chosen");
  const before = document.activeElement;
  const walk = await shown();
  fireEvent.keyDown(walk, { key: "ArrowRight" });
  nodes.splice(0, 1);
  // SAFETY: the rail reads only the event name.
  m.app.emit({ actor: { kind: "user", id: "you", parent: null }, name: "rail.changed" } as never);
  await waitFor(() => expect(m.connected.rail.nodes.some(node => node.id === "chosen")).toBe(false));
  fireEvent.keyDown(walk, { key: "ArrowRight" });
  fireEvent.keyDown(walk, { key: "Enter" });
  await waitFor(() => expect(walkEl()).toBeNull());
  expect(m.messages()).toEqual([]);
  expect(m.connected.rail.selected()).not.toBe("chosen");
  await waitFor(() => expect(document.activeElement).toBe(before));
});

it("pw6_the_walk_has_no_answer_box", async () => {
  const m = await mount();
  m.click("notes");
  const walk = await shown();
  expect(walk.querySelectorAll("textarea, input, [contenteditable=true], [role=textbox]")).toHaveLength(0);
  expect(m.messages()).toEqual([]);
});
