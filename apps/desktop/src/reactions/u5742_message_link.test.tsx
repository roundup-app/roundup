import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import type { Reaction } from "@contracts/reaction/Reaction";
import { App } from "../App";
import { RpcError } from "../app/seam";
import { createFakeApp } from "../testing/fakeApp";
import { agent, door, info } from "../testing/nodes";
import { fakeEmulators } from "../terminal/paneHarness";
import type { ConnectedProject } from "../state/connectedProject";

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); });

const mount = async (kind: "agent" | "workstream") => {
  const app = createFakeApp();
  app.add("/project");
  const target = kind === "agent" ? agent("chosen", "idle", "ready") : door("chosen", "idle", "ready");
  app.handlers["rail.tree"] = () => [target, agent("other", "idle", "ready")];
  app.handlers["terminal.list"] = () => [info("t-chosen", { owner: "chosen" }), info("t-other", { owner: "other" })];
  app.handlers["terminal.snapshot"] = () => ({ cols: 80, rows: 24, after: 0, data: "" });
  app.handlers["terminal.resize"] = () => null;
  app.handlers["terminal.write"] = () => null;
  app.handlers["link.read"] = () => kind === "agent" ? { kind, id: "chosen", node: target, digest: null } : { kind, id: "chosen", node: target, children: [] };

  const reaction: Reaction = {
    project: "p", reason: "Review the output", id: "r", name: "Review", actor: { kind: "user", id: "u", parent: null }, home: null, target: "other",
    instruction: "go", condition: { kind: "agents", ids: ["other"], any: false }, max_firings: 1, remaining: 0, rearm: false,
    expires_at: "2026-11-02T09:00:00Z", created_at: "2026-11-01T09:00:00Z", state: "stopped",
    observation: { health: "observing", health_code: "observing", cause_code: "unknown", gap_code: "unknown", recovery_code: "unknown", cursor: null, gap: null, recovery: null, evidence: null },
    firings: [{ id: "f", ordinal: 1, message: 42, matched: true, evidence: "finished", definition: "{}", outcome: "delivered" }],
  };

  const url = `roundup://${kind}/chosen?project=project-0000000000000000`;
  app.handlers["reaction.list"] = () => [reaction];
  app.handlers["message.get"] = () => ({ id: 42, from: reaction.actor, to: "other", body: `Choose ${url}.`, kind: "note", replyTo: null, status: "delivered", reason: null, at: 0 });
  const emulators = fakeEmulators();
  let connected!: ConnectedProject;
  render(() => <App app={app} createEmulator={emulators.factory} reducedMotion={() => true} clock={() => 0} prepareIdle={open => { connected = open; open.showView("reactions"); }} />);
  fireEvent.click(await screen.findByRole("button", { name: /Review/ }));
  fireEvent.click(await screen.findByRole("button", { name: /Firing 1/ }));
  const link = await screen.findByRole("link", { name: url });

  return { app, connected, emulators, link, url };
};

it.each(["agent", "workstream"] as const)("u5742c_message_link_choice_focuses_terminal_%s", async kind => {
  const m = await mount(kind);
  fireEvent.click(m.link);
  await waitFor(() => expect(document.activeElement?.closest(".pane-screen")?.querySelector("[data-terminal]")?.getAttribute("data-terminal")).toBe("t-chosen"));
  expect(m.connected.rail.selected()).toBe("chosen");
  expect(m.app.calls.filter(call => call.method === "link.read").map(call => call.params)).toEqual([{ url: m.url }]);
  expect(m.app.calls.filter(call => /spawn|start|write/.test(call.method))).toEqual([]);
  m.emulators.made.get("t-chosen")!.type(new TextEncoder().encode("u5742 marker"));
  await waitFor(() => expect(m.app.calls.filter(call => call.method === "terminal.write").map(call => call.params)).toEqual([{ id: "t-chosen", data: btoa("u5742 marker") }]));
  expect(m.app.openedTargets).toEqual([]);
});

it("u5742c_refused_message_link_opens_nothing_and_exposes_its_cause", async () => {
  const m = await mount("agent");
  const selected = m.connected.rail.selected();
  m.app.handlers["link.read"] = () => { throw new RpcError(-32003, "Object access was refused"); };

  fireEvent.click(m.link);
  await screen.findByText("Object access was refused");
  expect(m.connected.rail.selected()).toBe(selected);
  expect(m.app.openedTargets).toEqual([]);
  expect(m.app.calls.filter(call => /spawn|start|write/.test(call.method))).toEqual([]);
});

it.each(["authorization", "readiness"] as const)("u5742d_message_link_preserves_newer_focus_%s", async stage => {
  const m = await mount("agent");

  if (stage === "authorization") {
    m.app.handlers["link.read"] = () => { throw new RpcError(-32003, "Previous refusal"); };

    fireEvent.click(m.link);
    await screen.findByText("Previous refusal");
  }

  let release!: () => void;

  if (stage === "authorization") m.app.handlers["link.read"] = () => new Promise(resolve => { release = () => resolve({ kind: "agent", id: "chosen", node: agent("chosen", "idle", "ready"), digest: null }); });
  else m.app.handlers["terminal.snapshot"] = () => new Promise(resolve => { release = () => resolve({ cols: 80, rows: 24, after: 0, data: "" }); });
  fireEvent.click(m.link);
  await waitFor(() => expect(release).toBeDefined());

  if (stage === "readiness") fireEvent.keyDown(document.activeElement!, { key: "/", code: "Slash", metaKey: true });
  const ask = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Ask" });
  ask.focus();
  fireEvent.input(ask, { target: { value: "keep my draft" } });
  release();

  if (stage === "authorization") await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  else await waitFor(() => expect(m.emulators.made.get("t-chosen")?.host).toBeTruthy());
  expect(document.activeElement).toBe(ask);
  expect(ask.value).toBe("keep my draft");
  expect(m.app.calls.filter(call => call.method === "terminal.write")).toEqual([]);
});
