import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { z } from "zod";
import { afterEach, expect, it, vi } from "vitest";
import type { Kind } from "@contracts/Kind";
import type { RailNode } from "@contracts/agent/RailNode";
import type { LinkEntry } from "@contracts/links/LinkEntry";
import type { LinkSet } from "@contracts/links/LinkSet";
import type { MadeItem } from "@contracts/links/MadeItem";
import type { Pad } from "@contracts/pad/Pad";
import { padReadStorage } from "../pads/padRead";
import { ConnectedProjectContext, connectProject } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { mountNavigation } from "../testing/navigationFixture";
import { agent, door, event, info, NOW } from "../testing/nodes";
import { LinksView, specOf } from "./catalogue";
import { copy } from "./copy";
import { LinksHeader } from "./LinksHeader";

import terminalSheet from "../terminal/styles.css?raw";

afterEach(cleanup);

const entry = (kind: LinkEntry["kind"], n: number): LinkEntry => ({ kind, url: `https://example.test/${kind}/${n}`, tooltip: `${kind} ${n}` });

const setOf = (count: number): LinkSet => ({ entries: Array.from({ length: count }, (_, n) => entry(n === 0 ? "pr" : "asked", n)) });

type Setup = { nodes?: RailNode[]; set?: LinkSet; made?: MadeItem[]; pads?: () => Pad[]; read?: Record<string, string>; folder?: string };

const padOf = (name: string, revision = 1): Pad => ({ incarnation: `${name}-1`, name, text: "x", updated_at: 0, revision, home: null, creator: { kind: "agent", id: "a", parent: null }, visibility: "shown" });

const mount = async (setup: Setup = {}) => {
  const app = createFakeApp();

  app.handlers["rail.tree"] = () => setup.nodes ?? [agent("a", "idle", "waiting")];
  app.handlers["agent.links"] = () => setup.set ?? { entries: [] };
  app.handlers["agent.made"] = () => setup.made ?? [];
  app.handlers["pad.list"] = () => setup.pads?.() ?? [];
  const { folder } = setup;

  if (folder) app.handlers["agent.dir"] = () => ({ path: folder });
  padReadStorage("/p").write(setup.read ?? {});

  const connected = await connectProject(app, { name: "p", path: "/p" }, () => false, () => 0);

  // The Terminal's box is the Pane's `.pane-screen`; the header is its sibling and takes no part in its layout.
  render(() => <ConnectedProjectContext value={connected}><div class="pane-body"><div class="pane-screen" /><LinksHeader active={() => true} /></div></ConnectedProjectContext>);
  await connected.rail.settled();
  connected.rail.select("a");
  flush();

  return { app, connected };
};

const names = () => [...document.querySelectorAll<HTMLElement>(".links-header [aria-label]")].map(each => each.getAttribute("aria-label"));

const handle = () => screen.getByRole("button", { name: new RegExp(`^(${copy.expand}|${copy.collapse})$`) });

const status = (app: ReturnType<typeof createFakeApp>, kind: Kind, revision: string) => app.emit(event({ name: "agent.status", data: { id: "a", attempt: "1", status_revision: revision, status: { kind, label: kind, since: NOW, finished: "0" } } }));

it("lh6_the_header_overlays_and_the_terminal_size_is_unchanged", async () => {
  for (const nodes of [[agent("a", "idle", "waiting")], [door("a", "idle", "waiting")]]) {
    const { app } = await mount({ nodes, set: setOf(2) });
    const terminal = document.querySelector<HTMLElement>(".pane-screen");

    if (!terminal) throw new Error("no Terminal");

    const box = () => terminal.outerHTML;
    const before = box();
    const stays = () => expect(box()).toBe(before);

    await waitFor(() => expect(names()).toContain("pr 0"));
    expect(terminal.contains(document.querySelector(".links-header"))).toBe(false);
    stays();
    fireEvent.click(handle());
    stays();
    fireEvent.click(handle());
    app.emit(event({ name: "agent.links", data: { id: "a", set: setOf(3) } }));
    await waitFor(() => expect(names()).toContain("asked 2"));
    stays();
    cleanup();
  }
});

it("lh6_the_terminal_keeps_a_fixed_top_inset_the_header_lies_over", async () => {
  const { app } = await mount({ set: setOf(2) });
  const pane = document.querySelector<HTMLElement>(".pane-body");
  const inset = () => pane?.style.getPropertyValue("--terminal-inset") ?? "";
  const before = inset();

  await waitFor(() => expect(names()).toContain("pr 0"));
  fireEvent.click(handle());
  fireEvent.click(handle());
  app.emit(event({ name: "agent.links", data: { id: "a", set: setOf(3) } }));
  await waitFor(() => expect(names()).toContain("asked 2"));
  expect(inset()).toBe(before);
  // The inset itself is a Token in the Pane's sheet, as tall as the header's gap, 24 px icon and gap (lh12_ reads its size).
  expect(terminalSheet).toMatch(/--terminal-inset: var\(--space-6\)/);
  expect(document.querySelector(".pane-screen")?.contains(document.querySelector(".links-header"))).toBe(false);
});

it("lh7_editor_and_terminal_icons_open_once", async () => {
  const { connected } = await mount();

  expect(names().slice(0, 2)).toEqual([copy.editor, copy.terminal]);
  fireEvent.click(screen.getByRole("button", { name: copy.terminal }));
  flush();
  expect(connected.creation()).toEqual({ kind: "terminal", home: "a" });
});

it("lh26_the_editor_icon_opens_the_folder_the_daemon_names", async () => {
  const { app } = await mount({ folder: "/tmp/loop-own/u1" });

  fireEvent.click(screen.getByRole("button", { name: copy.editor }));
  await waitFor(() => expect(app.editorOpened).toEqual(["/tmp/loop-own/u1"]));
  expect(app.calls.filter(call => call.method === "agent.dir").map(call => call.params)).toEqual([{ id: "a" }]);
});

it("lh8_entries_render_as_catalogue_icons_and_open_once", async () => {
  const { app } = await mount({ set: { entries: [entry("pr", 1), entry("dev-server", 2)] } });

  await waitFor(() => expect(names()).toEqual([copy.editor, copy.terminal, "pr 1", "dev-server 2", copy.collapse]));
  fireEvent.click(screen.getByRole("button", { name: "dev-server 2" }));
  expect(app.openedTargets).toEqual([{ kind: "url", url: "https://example.test/dev-server/2" }]);
});

it("lh8_an_unknown_component_renders_nothing", () => {
  const spec = specOf(setOf(1));

  spec.elements.header?.children?.push("chat");
  spec.elements.chat = { type: "Chat", props: { tooltip: "talk" }, children: [] };
  render(() => <LinksView spec={spec} env={{ editor: () => {}, terminal: () => {}, open: () => {}, file: () => {}, made: () => {} }} />);
  expect(screen.getAllByRole("button").map(each => each.getAttribute("aria-label"))).toEqual([copy.editor, copy.terminal, "pr 0"]);
});

it("lh9_more_than_six_icons_show_six_and_a_count", async () => {
  const { app } = await mount({ set: setOf(6) });

  await waitFor(() => expect(names()).toContain("asked 3"));
  expect(names().slice(0, 7)).toEqual([copy.editor, copy.terminal, "pr 0", "asked 1", "asked 2", "asked 3", copy.moreName(2)]);
  expect(names()).not.toContain("asked 5");
  fireEvent.click(screen.getByRole("button", { name: copy.moreName(2) }));
  expect(names()).toContain("asked 5");
  fireEvent.click(screen.getByRole("button", { name: "asked 5" }));
  expect(app.openedTargets).toEqual([{ kind: "url", url: "https://example.test/asked/5" }]);
});

it("lh9_six_or_fewer_show_no_count", async () => {
  await mount({ set: setOf(4) });
  await waitFor(() => expect(names()).toContain("asked 3"));
  expect(document.querySelector(".links-count")).toBeNull();
});

it("lh10_working_collapses_and_other_kinds_show", async () => {
  const { app } = await mount({ nodes: [agent("a", "working", "busy")] });

  expect(handle().getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("button", { name: copy.editor })).toBeNull();
  status(app, "idle", "2");
  await waitFor(() => expect(handle().getAttribute("aria-expanded")).toBe("true"));
  expect(screen.getByRole("button", { name: copy.editor })).toBeTruthy();
});

it("lh10_the_users_toggle_holds_until_the_status_changes", async () => {
  const { app } = await mount({ nodes: [agent("a", "working", "busy")] });

  fireEvent.click(handle());
  expect(handle().getAttribute("aria-expanded")).toBe("true");
  status(app, "working", "1");
  flush();
  expect(handle().getAttribute("aria-expanded")).toBe("true");
  status(app, "idle", "2");
  await waitFor(() => expect(handle().getAttribute("aria-expanded")).toBe("true"));
  fireEvent.click(handle());
  expect(handle().getAttribute("aria-expanded")).toBe("false");
  status(app, "working", "3");
  await waitFor(() => expect(handle().getAttribute("aria-expanded")).toBe("false"));
  status(app, "needs-you", "4");
  await waitFor(() => expect(handle().getAttribute("aria-expanded")).toBe("true"));
});

it("lh10_a_set_change_keeps_the_users_toggle", async () => {
  const { app } = await mount({ nodes: [agent("a", "working", "busy")] });

  fireEvent.click(handle());
  app.emit(event({ name: "agent.links", data: { id: "a", set: setOf(2) } }));
  await waitFor(() => expect(names()).toContain("pr 0"));
  expect(handle().getAttribute("aria-expanded")).toBe("true");
});

it("lh13_a_narrow_pane_keeps_the_header_to_one_row_inside_the_inset", async () => {
  const callbacks: (() => void)[] = [];
  let paneWidth = 800;

  vi.stubGlobal("ResizeObserver", class { constructor(run: () => void) { callbacks.push(run); } observe() {} disconnect() {} });
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(() => paneWidth);

  try {
    await mount({ set: setOf(6) });
    callbacks.forEach(run => run());
    flush();
    await waitFor(() => expect(names()).toContain(copy.moreName(2)));

    paneWidth = 150;
    callbacks.forEach(run => run());
    flush();
    await waitFor(() => expect(names()).toContain(copy.moreName(6)));
    fireEvent.click(screen.getByRole("button", { name: copy.moreName(6) }));
    expect(document.querySelector(".links-popover")?.querySelectorAll("button").length).toBe(6);
    await waitFor(() => expect(document.querySelector(".links-popover")?.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(document.querySelector(".links-popover")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: copy.moreName(6) })));
  } finally {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
});

it("lh15_the_terminal_icon_on_a_mode_agent_opens_its_terminal", async () => {
  const { daemon, connected, shells } = await mountNavigation(false, 0, 2);

  daemon.handlers["terminal.open"] = params => {
    const owner = z.object({ workstream: z.string() }).parse(params).workstream;

    if (owner !== "a1") throw new Error(`${owner} is not an Agent`);
    shells.push(info("shell", { owner }));

    return { terminal_id: "shell" };
  };

  connected().rail.select("a1");
  flush();
  fireEvent.click(await screen.findByRole("button", { name: copy.terminal }));
  await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("shell"));
  expect(daemon.calls.filter(call => call.method === "terminal.open").map(call => z.object({ workstream: z.string() }).parse(call.params).workstream)).toEqual(["a1"]);
  expect(screen.queryByText(/is not/)).toBeNull();
});

const madeSet: MadeItem[] = [
  { kind: "pad", id: "plan", title: "Plan" },
  { kind: "file", id: "d1", title: "Report" },
];

const unread = { pads: () => [padOf("plan")] };

it("lh21_made_items_follow_the_links_with_their_kind_icon", async () => {
  await mount({ set: setOf(1), made: madeSet, ...unread });
  await waitFor(() => expect(names()).toContain("Pad: Plan"));
  expect(names()).toEqual([copy.editor, copy.terminal, "pr 0", "Pad: Plan", "File: Report", copy.collapse]);
  expect(document.querySelectorAll(".links-made svg").length).toBe(2);
  cleanup();
  await mount({});
  expect(names()).toEqual([copy.editor, copy.terminal, copy.collapse]);
});

it("lh21_a_tooltip_stays_within_five_words", () => {
  const tip = copy.madeTooltip({ kind: "pad", title: "Check the release notes before shipping today" });

  expect(tip.split(" ").length).toBeLessThanOrEqual(5);
  expect(tip).toBe("Pad: Check the release notes");
});

it("lh22_a_click_opens_the_pad_or_file_once", async () => {
  const { app, connected } = await mount({ made: madeSet, ...unread });
  const open = vi.spyOn(connected.drawer, "open").mockImplementation(() => undefined);

  app.handlers["deliverable.resolve"] = () => ({ kind: "retained", path: "/p/report.md", sha256: "x" });
  await waitFor(() => expect(names()).toContain("Pad: Plan"));
  fireEvent.click(screen.getByRole("button", { name: "Pad: Plan" }));
  expect(open).toHaveBeenCalledTimes(1);
  expect(open.mock.calls[0]?.[2]).toEqual({ kind: "pad", project: "/p" });
  fireEvent.click(screen.getByRole("button", { name: "File: Report" }));
  await waitFor(() => expect(app.calls.filter(call => call.method === "deliverable.resolve").length).toBe(1));
  expect(open).toHaveBeenCalledTimes(1);
});

it("lh22_nothing_opens_without_a_click", async () => {
  const { app, connected } = await mount({ made: madeSet, ...unread });
  const open = vi.spyOn(connected.drawer, "open").mockImplementation(() => undefined);

  await waitFor(() => expect(names()).toContain("Pad: Plan"));
  app.emit(event({ name: "agent.made", data: { id: "a" } }));
  flush();
  expect(open).not.toHaveBeenCalled();
  expect(app.calls.some(call => call.method === "deliverable.resolve")).toBe(false);
});

it("lh23_made_icons_share_the_six_icon_limit_and_the_count", async () => {
  await mount({ set: setOf(4), made: madeSet, ...unread });
  await waitFor(() => expect(names()).toContain(copy.moreName(2)));
  expect(names().slice(0, 7)).toEqual([copy.editor, copy.terminal, "pr 0", "asked 1", "asked 2", "asked 3", copy.moreName(2)]);
  fireEvent.click(screen.getByRole("button", { name: copy.moreName(2) }));
  expect([...document.querySelectorAll(".links-popover button")].map(each => each.getAttribute("aria-label"))).toEqual(["Pad: Plan", "File: Report"]);
});

it("lh27_a_pad_shows_only_while_unread_and_comes_back_when_it_changes", async () => {
  let revision = 1;
  const { app } = await mount({ made: madeSet, pads: () => [padOf("plan", revision)], read: { "plan-1": "1" } });

  await waitFor(() => expect(names()).toContain("File: Report"));
  expect(names()).toEqual([copy.editor, copy.terminal, "File: Report", copy.collapse]);
  revision = 2;
  app.emit(event({ name: "pad.changed", data: { name: "plan" } }));
  await waitFor(() => expect(names()).toContain("Pad: Plan"));
});

it("lh28_a_file_entry_opens_the_editor_at_its_line", async () => {
  const file: LinkEntry = { kind: "file", url: "", path: "/p/src/a.ts", line: 12, tooltip: "a.ts" };
  const { app } = await mount({ set: { entries: [file] } });

  await waitFor(() => expect(names()).toEqual([copy.editor, copy.terminal, "a.ts", copy.collapse]));
  fireEvent.click(screen.getByRole("button", { name: "a.ts" }));
  await waitFor(() => expect(app.editorCalls).toEqual([{ path: "/p/src/a.ts", line: 12 }]));
  expect(app.openedTargets).toEqual([]);
});
