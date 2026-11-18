import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, expect, it } from "vitest";
import type { Kind } from "@contracts/Kind";
import type { RailNode } from "@contracts/agent/RailNode";
import type { LinkEntry } from "@contracts/links/LinkEntry";
import type { LinkSet } from "@contracts/links/LinkSet";
import { ConnectedProjectContext, connectProject } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { agent, door, event, NOW } from "../testing/nodes";
import { LinksView, specOf } from "./catalogue";
import { copy } from "./copy";
import { LinksHeader } from "./LinksHeader";

afterEach(cleanup);

const entry = (kind: LinkEntry["kind"], n: number): LinkEntry => ({ kind, url: `https://example.test/${kind}/${n}`, tooltip: `${kind} ${n}` });

const setOf = (count: number): LinkSet => ({ entries: Array.from({ length: count }, (_, n) => entry(n === 0 ? "pr" : "asked", n)) });

type Setup = { nodes?: RailNode[]; set?: LinkSet };

const mount = async (setup: Setup = {}) => {
  const app = createFakeApp();

  app.handlers["rail.tree"] = () => setup.nodes ?? [agent("a", "idle", "waiting")];
  app.handlers["agent.links"] = () => setup.set ?? { entries: [] };

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

it("lh7_editor_and_terminal_icons_open_once_on_the_worktree_or_folder", async () => {
  const withTree = agent("a", "idle", "waiting", { worktree: { path: "/p/.wt/a", branch: "a", base: "main" } });

  for (const [nodes, folder] of [[[withTree], "/p/.wt/a"], [undefined, "/p"]] as const) {
    const { app, connected } = await mount(nodes ? { nodes: [...nodes] } : {});

    expect(names().slice(0, 2)).toEqual([copy.editor, copy.terminal]);
    fireEvent.click(screen.getByRole("button", { name: copy.editor }));
    expect(app.editorOpened).toEqual([folder]);
    fireEvent.click(screen.getByRole("button", { name: copy.terminal }));
    flush();
    expect(connected.creation()).toEqual({ kind: "terminal", home: "a" });
    cleanup();
  }
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
  render(() => <LinksView spec={spec} env={{ editor: () => {}, terminal: () => {}, open: () => {} }} />);
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
