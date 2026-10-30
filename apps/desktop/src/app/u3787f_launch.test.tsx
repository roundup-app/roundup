import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { App } from "../App";
import { createFakeApp } from "../testing/fakeApp";
import { agent, info, workstream } from "../testing/nodes";
import { fakeEmulators } from "../terminal/paneHarness";
import { RpcError, type NativeOpen } from "./seam";
import { linkCopy } from "../copy/link";

let receive: ((request: NativeOpen) => void) | undefined;

afterEach(() => { cleanup(); window.localStorage.clear(); receive = undefined; });

it("u3787f_second_launch_reuses_the_app_opens_the_delivered_project", async () => {
  const app = createFakeApp();
  app.onNativeOpen = async listener => { receive = listener;

    return () => {}; };

  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} prepareIdle={open => open.showView("workstreams")} />);
  await waitFor(() => expect(receive).toBeDefined());
  receive?.({ kind: "project", path: "/invocation/second" });
  await screen.findByRole("tab", { name: "second" });
  expect(app.calls.filter(call => /spawn|start|input|write/.test(call.method))).toEqual([]);
});

it("u3787f_deep_link_preserves_identity_and_authority_refuses_without_opening_a_path", async () => {
  const app = createFakeApp();
  app.onNativeOpen = async listener => { receive = listener;

    return () => {}; };

  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} prepareIdle={open => open.showView("workstreams")} />);
  await waitFor(() => expect(receive).toBeDefined());
  receive?.({ kind: "link", url: "roundup://pad/notes?project=unavailable" });
  await screen.findByText(/Project.*not open/);
  expect(app.calls.filter(call => /spawn|start|input|write/.test(call.method))).toEqual([]);
});

it("u3787f_deep_link_preserves_identity_and_authority_reveals_the_exact_terminal", async () => {
  const app = createFakeApp();
  app.add("/project");
  app.onNativeOpen = async listener => { receive = listener;

    return () => {}; };

  app.handlers["rail.tree"] = () => [agent("a", "idle", "ready")];
  app.handlers["terminal.list"] = () => [info("t-a"), info("first", { owner: "a", title: "Chosen terminal" }), info("second", { owner: "a" })];
  app.handlers["terminal.snapshot"] = () => ({ cols: 80, rows: 24, after: 0, data: "" });
  app.handlers["terminal.resize"] = () => null;
  app.handlers["link.read"] = () => ({ kind: "terminal", id: "first", screen: { cols: 80, rows: 24, offset: 0, lines: ["chosen screen"], truncated: false } });
  const { factory } = fakeEmulators();

  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} createEmulator={factory} prepareIdle={open => open.showView("workstreams")} />);
  await screen.findByRole("tab", { name: "project" });
  receive?.({ kind: "link", url: "roundup://terminal/first?project=project-0000000000000000" });
  await screen.findByRole("group", { name: "Chosen terminal" });
  expect(app.calls.filter(call => /spawn|start|input|write/.test(call.method))).toEqual([]);
});

it.each(["agent", "workstream"] as const)("u3787f_deep_link_preserves_identity_and_authority_selects_the_exact_%s", async kind => {
  const app = createFakeApp();
  const target = kind === "agent" ? agent("chosen", "done", "finished") : workstream("chosen");
  app.add("/project");
  app.handlers["rail.tree"] = () => [target, agent("other", "done", "finished")];
  app.handlers["link.read"] = () => kind === "agent"
    ? { kind, id: target.id, node: target, digest: null }
    : { kind, id: target.id, node: target, children: [] };
  app.onNativeOpen = async listener => { receive = listener;

    return () => {}; };

  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} prepareIdle={open => open.showView("workstreams")} />);
  await screen.findByRole("tab", { name: "project" });
  receive?.({ kind: "link", url: `roundup://${kind}/chosen?project=project-0000000000000000` });
  await waitFor(() => expect(document.querySelector('[data-id="chosen"]')?.getAttribute("aria-selected")).toBe("true"));
  expect(app.calls.filter(call => /spawn|start|input|write/.test(call.method))).toEqual([]);
});


it("u3787f_deep_link_preserves_identity_and_authority_same_named_pad_in_another_project", async () => {
  const app = createFakeApp();
  app.add("/first", "First");
  app.add("/second", "Second");
  const a = app.of("/first");
  const b = app.of("/second");
  const name = "notes 雪";
  const firstText = "wrong Project";
  const secondText = "# Details\nExact second Project section";
  const firstPad = { incarnation: "first-pad", name, text: firstText, updated_at: 0, revision: 1, home: null };
  const secondPad = { ...firstPad, incarnation: "second-pad", text: secondText };
  a.handlers["pad.read"] = () => firstPad;
  b.handlers["pad.read"] = () => secondPad;
  a.handlers["link.read"] = () => { throw new RpcError(-32001, "Not this Project", { kind: "other-project" }); };
  b.handlers["link.read"] = () => ({ kind: "pad", id: name, pad: secondPad, section: { heading: "Details", text: "Exact second Project section" } });
  app.onNativeOpen = async listener => { receive = listener;

    return () => {}; };

  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} prepareIdle={open => open.showView("workstreams")} />);
  await waitFor(() => expect(receive).toBeDefined());
  const url = `roundup://pad/${encodeURIComponent(name)}?project=second-0000000000000000#Details`;
  receive?.({ kind: "link", url });
  const body = await screen.findByRole("textbox", { name: "Pad body" });
  await waitFor(() => expect(body.textContent).toContain("Exact second Project section"));
  expect(body.textContent).not.toContain(firstText);
  expect(a.calls.filter(call => call.method === "link.read")).toEqual([{ method: "link.read", params: { url } }]);
  expect(b.calls.filter(call => call.method === "link.read")).toEqual([{ method: "link.read", params: { url } }]);
  expect(a.calls.filter(call => call.method === "pad.read")).toEqual([]);
  expect(b.calls.filter(call => call.method === "pad.read")).toContainEqual({ method: "pad.read", params: { name } });

  b.handlers["link.read"] = () => { throw new RpcError(-32001, "missing Pad"); };
  receive?.({ kind: "link", url: "roundup://pad/missing?project=second-0000000000000000" });
  await screen.findByText(/missing Pad/);
  expect(screen.queryByText(/Not this Project/)).toBeNull();
  await app.closeProject("/second");
  receive?.({ kind: "link", url });
  await screen.findByText(linkCopy.projectClosed);
  expect([...a.calls, ...b.calls].filter(call => /spawn|start|input|write|create|delete/.test(call.method))).toEqual([]);
});
