import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { batch } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { RequestedApp as App } from "../testing/requestedApp";
import { createFakeApp } from "../testing/fakeApp";
import { agent, door } from "../testing/nodes";
import { TargetText } from "../terminal/TargetText";
import { ConnectedProjectContext, type ConnectedProject } from "../state/connectedProject";
import { RpcError, type NativeOpen } from "./seam";
import { keyOfPath } from "./linkRoute";

afterEach(() => { batch(cleanup); localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks(); });

const KEY = "project-0000000000000000";

/** A Project "/project" whose surface shows `text` through the one TargetText every Ask row, Inbox row and Bubble uses. */
const mountSurface = async (text: string, kind: "agent" | "workstream" = "agent") => {
  const app = createFakeApp();
  app.add("/project");
  const target = kind === "agent" ? agent("chosen", "idle", "ready") : door("chosen", "idle", "ready");
  app.handlers["rail.tree"] = () => [target];
  app.handlers["terminal.list"] = () => [];
  app.handlers["link.read"] = () => kind === "agent" ? { kind, id: "chosen", node: target, digest: null } : { kind, id: "chosen", node: target, children: [] };
  let receive: ((request: NativeOpen) => void) | undefined;
  app.onNativeOpen = async listener => { receive = listener;

 return () => {}; };

  let connected!: ConnectedProject;
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} prepareIdle={open => { connected = open; }} />);
  await waitFor(() => expect(connected).toBeDefined());
  await waitFor(() => expect(receive).toBeDefined());
  render(() => <ConnectedProjectContext.Provider value={connected}><TargetText objectLinks text={text} base="/project" /></ConnectedProjectContext.Provider>);

  return { app, connected, receive: receive!, link: text.includes("://") ? await screen.findByRole("link") : null! };
};

it.each(["agent", "workstream"] as const)("u6249c_projectless_link_opens_in_surface_project_%s", async kind => {
  const m = await mountSurface(`roundup://${kind}/chosen`, kind);
  fireEvent.click(m.link);
  await waitFor(() => expect(m.connected.rail.selected()).toBe("chosen"));
  expect(m.app.calls.filter(call => call.method === "link.read").map(call => call.params)).toEqual([{ url: `roundup://${kind}/chosen?project=${KEY}` }]);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("u6249c_named_project_is_kept", async () => {
  const url = "roundup://agent/chosen?project=second-0000000000000000";
  const m = await mountSurface(url);
  m.app.handlers["link.read"] = () => { throw new RpcError(-32001, "Not this Project", { kind: "other-project" }); };

  fireEvent.click(m.link);
  await waitFor(() => expect(m.app.calls.filter(call => call.method === "link.read")).toHaveLength(1));
  expect(m.app.calls.filter(call => call.method === "link.read").map(call => call.params)).toEqual([{ url }]);
});

it("u6249c_os_link_without_project_stays_malformed", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const m = await mountSurface("plain");
  m.app.handlers["link.read"] = () => { throw new RpcError(-32602, "not a link: the `project` parameter is missing"); };

  m.receive({ kind: "link", url: "roundup://agent/4" });
  await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
  expect(String(warn.mock.calls[0]?.[0])).toContain("the `project` parameter is missing");
  expect(m.app.calls.filter(call => call.method === "link.read").map(call => call.params)).toEqual([{ url: "roundup://agent/4" }]);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("u6249c_deliverable_link_opens_made", async () => {
  const m = await mountSurface("plain");
  // SAFETY: the link only reads the record's id; a full Deliverable adds nothing to this clause.
  m.app.handlers["link.read"] = () => ({ kind: "deliverable", record: { id: "d1" }, resolution: { kind: "unavailable", cause: "gone" } } as never);
  m.receive({ kind: "link", url: "roundup://deliverable/d1?project=project-0000000000000000" });
  await waitFor(() => expect(m.connected.hasView("made")).toBe(true));
  expect(m.connected.madeSelected()).toBe("d1");
  expect(screen.queryByRole("alert")).toBeNull();
});

it("u6249c_link_failure_has_one_surface", async () => {
  const m = await mountSurface("roundup://agent/chosen");
  m.app.handlers["link.read"] = () => { throw new RpcError(-32001, "not found: agent chosen"); };

  fireEvent.click(m.link);
  await screen.findByText("not found: agent chosen");
  expect(screen.getAllByRole("alert")).toHaveLength(1);
});

it("u6249c_project_key_matches_the_daemons", async () => {
  // `printf '%s' /Users/x/closed | shasum -a 256` starts 9c99096382081341; the Daemon builds its Project key the same way.
  expect(await keyOfPath("/Users/x/closed")).toBe("closed-9c99096382081341");
});

it("u6249c_closed_project_link_offers_open", async () => {
  const m = await mountSurface("plain");
  m.app.recentProjects = async () => ["/Users/x/closed"];
  m.app.handlers["link.read"] = () => { throw new RpcError(-32001, "Not this Project", { kind: "other-project" }); };

  m.receive({ kind: "link", url: "roundup://agent/4?project=closed-9c99096382081341" });
  fireEvent.click(await screen.findByRole("button", { name: "Open closed" }));
  await waitFor(() => expect(m.app.of("/Users/x/closed").calls.filter(call => call.method === "link.read")).toHaveLength(1));
  await waitFor(() => { if (screen.queryByRole("button", { name: "Open closed" })) throw new Error("the action still shows"); });
});

it("u6249c_symlinked_recent_project_offers_open", async () => {
  const m = await mountSurface("plain");
  m.app.recentProjects = async () => ["/Users/x/link"];
  m.app.canonicalProjectPath = async () => "/Users/x/real/closed";
  m.app.handlers["link.read"] = () => { throw new RpcError(-32001, "Not this Project", { kind: "other-project" }); };

  m.receive({ kind: "link", url: `roundup://agent/4?project=${await keyOfPath("/Users/x/real/closed")}` });
  fireEvent.click(await screen.findByRole("button", { name: "Open link" }));
  await waitFor(() => expect(m.app.of("/Users/x/link").calls.filter(call => call.method === "link.read")).toHaveLength(1));
});

it("u6249c_unresolvable_recent_path_is_skipped", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const m = await mountSurface("plain");
  m.app.recentProjects = async () => ["/Users/x/closed"];
  m.app.canonicalProjectPath = async () => { throw new RpcError(-32001, "gone"); };

  m.app.handlers["link.read"] = () => { throw new RpcError(-32001, "Not this Project", { kind: "other-project" }); };

  m.receive({ kind: "link", url: "roundup://agent/4?project=closed-9c99096382081341" });
  await waitFor(() => expect(warn).toHaveBeenCalled());
});
