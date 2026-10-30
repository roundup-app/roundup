import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { App } from "../App";
import { createFakeApp } from "../testing/fakeApp";
import { RpcError, type NativeOpen } from "./seam";

let receive: ((request: NativeOpen) => void) | undefined;

afterEach(() => { cleanup(); window.localStorage.clear(); receive = undefined; });

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
  await waitFor(() => expect(body.textContent).toContain(secondText.split("\n")[1]));
  expect(body.textContent).not.toContain(firstPad.text);
  expect(a.calls.filter(call => call.method === "link.read")).toEqual([{ method: "link.read", params: { url } }]);
  expect(b.calls.filter(call => call.method === "link.read")).toEqual([{ method: "link.read", params: { url } }]);
  expect(a.calls.filter(call => call.method === "pad.read")).toEqual([]);
  expect(b.calls.filter(call => call.method === "pad.read")).toContainEqual({ method: "pad.read", params: { name } });

  expect([...a.calls, ...b.calls].filter(call => /spawn|start|input|write|create|delete/.test(call.method))).toEqual([]);
});

it("u3787f_deep_link_reports_the_target_failure_without_foreign_project_refusals", async () => {
  const app = createFakeApp();
  app.add("/first", "First");
  app.add("/second", "Second");
  const a = app.of("/first");
  const b = app.of("/second");
  a.handlers["link.read"] = () => { throw new RpcError(-32001, "Not this Project", { kind: "other-project" }); };

  b.handlers["link.read"] = () => { throw new RpcError(-32001, "missing Pad"); };

  app.onNativeOpen = async listener => { receive = listener;

    return () => {}; };

  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} prepareIdle={open => open.showView("workstreams")} />);
  await waitFor(() => expect(receive).toBeDefined());
  receive?.({ kind: "link", url: "roundup://pad/missing?project=second-0000000000000000" });
  await screen.findByText(/missing Pad/);
  expect(screen.queryByText(/Not this Project/)).toBeNull();
  expect([...a.calls, ...b.calls].filter(call => /spawn|start|input|write|create|delete/.test(call.method))).toEqual([]);
});
