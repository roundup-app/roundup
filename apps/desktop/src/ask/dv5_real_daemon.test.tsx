// @vitest-environment jsdom
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { ConnectedProjectContext, connectProject } from "../state/connectedProject";
import { createServedApp } from "../testing/realSeam";
import { startRealDaemon, type StartedDaemon } from "../testing/realDaemonFixture";
import { RpcError } from "../app/seam";
import type { OpenTarget } from "../app/seam";
import { AskBar } from "./AskBar";
import { App } from "../App";
import { fakeEmulators } from "../terminal/paneHarness";
import { createProjectDrafts } from "../state/connectedProject";

const exec = promisify(execFile);

let real: StartedDaemon;

beforeAll(async () => { real = await startRealDaemon({}); }, 120_000);

afterAll(async () => { await real?.stop(); });

afterEach(cleanup);

it("dv5_discover_open_retained_and_current_targets_after_reopen", async () => {
  const app = createServedApp(real.base);
  const home = await app.rpc("rail.createWorkstream", { name: "Made Home", parent: null });
  await writeFile(join(real.dir, "result.txt"), "published bytes");
  const record = await app.rpc("deliverable.publish", { key: "file", title: "Same title", target: { kind: "file", path: "result.txt" } });
  const link = await app.rpc("deliverable.publish", { key: "link", title: "Same title", target: { kind: "external", url: "https://example.com/exact?revision=1" } });
  await app.rpc("deliverable.move", { project: record.project, id: record.id, home: home.id });
  const other = await app.rpc("rail.createWorkstream", { name: "Other Home", parent: null });
  const makers = [];

  for (let n = 0; n < 10; n += 1) {
    const maker = await app.rpc("agent.spawn", { cwd: real.dir, prompt: null, parent: n < 5 ? home.id : other.id, name: `Maker ${n}` });
    makers.push(maker);
    await exec(resolve("../../target/debug/rup"), ["deliverable", "publish", `maker-${n}`, "Same title", "--agent", maker.id, "--target", JSON.stringify({ kind: "external", url: `https://example.com/maker/${n}` })], { env: { ...process.env, RUPD_SOCKET: join(real.dir, "rupd.sock") } });
    await app.rpc("agent.stop", { id: maker.id });
  }

  await app.rpc("pad.create", { name: "published-pad", text: "Pad revision one" });
  const pad = await app.rpc("pad.read", { name: "published-pad" });
  await app.rpc("deliverable.publish", { key: "pad", title: "Same title", target: { kind: "pad", name: pad.name, incarnation: pad.incarnation, revision: pad.revision } });
  await app.rpc("pad.write", { name: "published-pad", text: "Pad revision two", expectedRevision: pad.revision });
  await writeFile(join(real.dir, "result.txt"), "new bytes");
  await real.restart();
  const opened: OpenTarget[] = [];
  app.openTarget = async target => { opened.push(target); };

  const rpc = app.rpc;
  const calls: string[] = [];
  app.rpc = (method, params) => { calls.push(method);

 return rpc(method, params); };

  const connected = await connectProject(app, { path: real.dir, name: "Project" }, () => false, () => 0);
  render(() => <ConnectedProjectContext.Provider value={connected}><AskBar /></ConnectedProjectContext.Provider>);
  const made = await screen.findByRole("region", { name: "Made" });
  const rows = await within(made).findAllByRole("listitem");
  expect(rows).toHaveLength(13);
  const file = rows.find(row => row.textContent?.includes("result.txt"))!;
  expect(file.textContent).toContain("Made Home");
  fireEvent.click(within(file).getByRole("button"));
  await waitFor(() => expect(made.getAttribute("aria-busy")).toBe("false"));
  expect(opened).toHaveLength(1);
  const target = opened[0]!;
  expect(target.kind).toBe("path");

  if (target.kind === "path") expect(await readFile(target.path, "utf8")).toBe("published bytes");
  const external = rows.find(row => row.textContent?.includes("https://example.com/exact"))!;
  fireEvent.click(within(external).getByRole("button"));
  await waitFor(() => expect(made.getAttribute("aria-busy")).toBe("false"));
  expect(opened[1]).toEqual({ kind: "url", url: "https://example.com/exact?revision=1" });
  expect(link.id).not.toBe(record.id);
  const publishedPad = rows.find(row => row.textContent?.includes("published-pad"))!;
  fireEvent.click(within(publishedPad).getByRole("button"));
  await waitFor(() => expect(made.getAttribute("aria-busy")).toBe("false"));
  const padTarget = opened[2]!;
  expect(padTarget.kind).toBe("path");

  if (padTarget.kind === "path") expect(await readFile(padTarget.path, "utf8")).toBe("Pad revision one");
  expect((await app.rpc("pad.read", { name: "published-pad" })).text).toBe("Pad revision two");
  expect(calls.filter(method => method.startsWith("agent.") || method.startsWith("message."))).toEqual([]);
  connected.rail.select(home.id);
  fireEvent.click(await screen.findByRole("button", { name: "Made" }));
  await waitFor(() => expect(within(screen.getByRole("region", { name: "Made" })).getAllByRole("listitem")).toHaveLength(6));
  connected.rail.select(makers[0]!.id);
  await waitFor(() => expect(within(screen.getByRole("region", { name: "Made" })).getAllByRole("listitem")).toHaveLength(1));
  expect(screen.getByRole("region", { name: "Made" }).textContent).toContain("https://example.com/maker/0");
});

it("dv5_open_failure_preserves_catalogue_selection_and_refuses_removed_or_revoked_cached_targets", async () => {
  const app = createServedApp(real.base);
  const link = await app.rpc("deliverable.publish", { key: "failure-link", title: "Failure link", target: { kind: "external", url: "https://example.com/refused" } });
  await app.rpc("pad.create", { name: "revoked-pad", text: "retained secret" });
  const source = await app.rpc("pad.read", { name: "revoked-pad" });
  const pad = await app.rpc("deliverable.publish", { key: "failure-pad", title: "Failure Pad", target: { kind: "pad", name: "revoked-pad", incarnation: source.incarnation, revision: source.revision } });
  await writeFile(join(real.dir, "removed-cache.txt"), "cached revision");
  const file = await app.rpc("deliverable.publish", { key: "removed-cache", title: "Cached file", target: { kind: "file", path: "removed-cache.txt" } });
  const opened: OpenTarget[] = [];
  let refusal: string | null = "external opener refused";
  app.openTarget = async target => { opened.push(target);

 if (refusal) throw new Error(refusal); };

  const connected = await connectProject(app, { path: real.dir, name: "Project" }, () => false, () => 0);
  render(() => <ConnectedProjectContext.Provider value={connected}><AskBar /></ConnectedProjectContext.Provider>);
  const made = await screen.findByRole("region", { name: "Made" });
  const linkButton = await within(made).findByRole("button", { name: new RegExp(`^Open Failure link ·`) });
  const count = within(made).getAllByRole("listitem").length;
  linkButton.focus();
  fireEvent.click(linkButton);
  await waitFor(() => expect(made.getAttribute("aria-busy")).toBe("false"));
  expect(within(made).getByRole("alert").textContent).toContain(refusal);
  expect(document.activeElement).toBe(linkButton);
  expect(linkButton.getAttribute("aria-current")).toBe("true");
  expect(within(made).getAllByRole("listitem")).toHaveLength(count);
  expect(opened).toEqual([{ kind: "url", url: "https://example.com/refused" }]);

  const padButton = within(made).getByRole("button", { name: new RegExp(`^Open Failure Pad ·`) });
  refusal = "native opener refused";
  fireEvent.click(padButton);
  await waitFor(() => expect(made.getAttribute("aria-busy")).toBe("false"));
  expect(within(made).getByRole("alert").textContent).toContain(refusal);
  expect(opened).toHaveLength(2);
  const cached = opened[1]!;
  expect(cached.kind).toBe("path");
  await app.rpc("pad.delete", { name: "revoked-pad" });
  refusal = null;
  fireEvent.click(padButton);
  await waitFor(() => expect(made.getAttribute("aria-busy")).toBe("false"));
  expect(opened).toHaveLength(2);
  expect(within(made).getByRole("alert")).toBeDefined();
  expect(within(made).getAllByRole("listitem")).toHaveLength(count);

  const fileButton = within(made).getByRole("button", { name: new RegExp(`^Open Cached file ·`) });
  fireEvent.click(fileButton);
  await waitFor(() => expect(made.getAttribute("aria-busy")).toBe("false"));
  expect(opened).toHaveLength(3);
  const cachedFile = opened[2]!;
  expect(cachedFile.kind).toBe("path");
  await app.rpc("deliverable.remove", { project: file.project, id: file.id });
  fireEvent.click(fileButton);
  await waitFor(() => expect(made.getAttribute("aria-busy")).toBe("false"));
  expect(opened).toHaveLength(3);

  if (cachedFile.kind === "path") await expect(readFile(cachedFile.path)).rejects.toThrow();
  await app.rpc("deliverable.remove", { project: link.project, id: link.id });
  fireEvent.click(linkButton);
  await waitFor(() => expect(made.getAttribute("aria-busy")).toBe("false"));
  expect(opened).toHaveLength(3);
  expect(within(made).getByRole("alert")).toBeDefined();
  expect(linkButton.getAttribute("aria-current")).toBe("true");
  expect(within(made).getAllByRole("listitem")).toHaveLength(count);
  expect(connected.rail.selected()).toBeNull();
  await expect(app.rpc("deliverable.publish", { key: "unsafe", title: "Unsafe", target: { kind: "external", url: "roundup://anything" } })).rejects.toThrow();
  expect(opened).toHaveLength(3);
  // A malformed upstream external resolution still cannot reach the native opener.
  const unsafe = vi.spyOn(app, "rpc").mockResolvedValueOnce({ kind: "external", url: "javascript:alert(1)", availability: "not-checked" });
  fireEvent.click(padButton);
  await waitFor(() => expect(made.getAttribute("aria-busy")).toBe("false"));
  expect(opened).toHaveLength(3);
  expect(within(made).getByRole("alert")).toBeDefined();
  unsafe.mockRestore();
  const rpc = app.rpc;
  app.rpc = (method, params) => method === "deliverable.list" ? Promise.reject(new Error("catalogue connection interrupted")) : rpc(method, params);
  fireEvent.click(within(made).getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(made.getAttribute("aria-busy")).toBe("false"));
  expect(within(made).getAllByRole("alert").some(alert => alert.textContent?.includes("catalogue connection interrupted"))).toBe(true);
  expect(within(made).getAllByRole("listitem")).toHaveLength(count);
  expect(padButton.getAttribute("aria-current")).toBe("true");
  app.rpc = rpc;
  cleanup();
  await real.restart();
  const reopened = await connectProject(app, { path: real.dir, name: "Project" }, () => false, () => 0);
  render(() => <ConnectedProjectContext.Provider value={reopened}><AskBar /></ConnectedProjectContext.Provider>);
  const catalogue = await screen.findByRole("region", { name: "Made" });
  await within(catalogue).findByRole("button", { name: new RegExp(`^Open Failure Pad ·`) });
  expect(within(catalogue).queryByRole("button", { name: new RegExp("^Open Cached file ·") })).toBeNull();
  expect(within(catalogue).queryByRole("button", { name: new RegExp("^Open Failure link ·") })).toBeNull();
});


it("u2773b_lost_ask_acknowledgement_reconciles_after_daemon_restart_without_duplicate_intake", async () => {
  const app = createServedApp(real.base);
  const original = await app.rpc("rail.createWorkstream", { name: "Captured", parent: null });
  await app.rpc("rail.rename", { id: original.id, name: "Renamed" });
  const replacement = await app.rpc("rail.createWorkstream", { name: "Captured", parent: null });
  const connected = await connectProject(app, { path: real.dir, name: "Project" }, () => false, () => 0);
  const rpc = app.rpc;
  let sends = 0;
  app.rpc = async (method, params) => {
    const result = await rpc(method, params);

    if (method === "ask.send") {
      sends += 1;
      throw new RpcError(-32004, "response lost after intake");
    }

    return result;
  };

  const outcome = await connected.asks.send({ text: " exact 🌿\n ", submission: "lost-response", workstream: original.id });
  expect(outcome.kind).toBe("unknown");
  await real.restart();
  const accepted = await connected.asks.reconcile("lost-response");
  expect(accepted).toMatchObject({ kind: "acknowledged", submission: "lost-response", ask: { text: " exact 🌿\n ", parts: [{ placement: { kind: "routed", workstream: original.id } }] } });
  expect(sends).toBe(1);
  app.rpc = rpc;
  const replay = await connected.asks.send({ text: " exact 🌿\n ", submission: "lost-response", workstream: original.id });
  expect(replay.kind).toBe("acknowledged");

  if (replay.kind === "acknowledged" && accepted.kind === "acknowledged") expect(replay.ask.id).toBe(accepted.ask.id);
  expect((await app.rpc("ask.list", null)).filter(ask => ask.submission === "lost-response")).toHaveLength(1);
  expect((await app.rpc("rail.tree", null)).find(node => node.id === replacement.id)?.terminal_id).toBeNull();
});


it("u2773a_ask_restores_original_projects_through_App_reopen", async () => {
  const second = await startRealDaemon({});
  const first = createServedApp(real.base);
  const other = createServedApp(second.base);
  const before = await first.rpc("ask.list", null);
  const original = await first.rpc("rail.createWorkstream", { name: "Same destination", parent: null });
  await other.rpc("rail.createWorkstream", { name: "Same destination", parent: null });
  const roots = new Map([[real.dir, first], [second.dir, other]]);
  const calls = [...roots.values()].map(bound => vi.spyOn(bound, "rpc"));
  let opened = [real.dir, second.dir];
  const projects = () => opened.map(path => ({ path, name: path === real.dir ? "first" : "second", running: true }));

  const app = {
    ...first,
    projects: async () => projects(),
    forProject: (path: string) => roots.get(path)!,
    chooseProjectPath: async () => real.dir,
    closeProject: async (path: string) => { opened = opened.filter(each => each !== path); },
    openProject: async (path: string) => { opened.push(path);

 return projects().find(each => each.path === path)!; },
    onDaemonExited: async () => () => {},
  };

  const owners = createProjectDrafts();
  const mount = () => render(() => <App app={app} drafts={owners} reducedMotion={() => true} clock={() => 0} createEmulator={fakeEmulators().factory} />);
  const field = () => screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Ask" });
  const exact = "@Same destination  e\u0301 🌿\nlast line  ";

  try {
    const view = mount();
    await screen.findByRole("tab", { name: "first" });
    fireEvent.click(screen.getByRole("tab", { name: "first" }));
    await screen.findByRole("textbox", { name: "Ask" });
    fireEvent.input(field(), { target: { value: exact } });
    field().setSelectionRange(2, 6, "backward");
    fireEvent.select(field());
    fireEvent.click(screen.getByRole("tab", { name: "second" }));
    await waitFor(() => expect(field().value).toBe(""));
    fireEvent.input(field(), { target: { value: "  second Project 東京\n " } });
    const focus = document.activeElement;
    await first.rpc("rail.rename", { id: original.id, name: "Renamed original" });
    expect(document.activeElement).toBe(focus);
    fireEvent.click(screen.getByRole("tab", { name: "first" }));
    await waitFor(() => expect(field().value).toBe(exact));
    expect([field().selectionStart, field().selectionEnd, field().selectionDirection]).toEqual([2, 6, "backward"]);
    const tab = document.querySelector<HTMLElement>(`[data-path="${real.dir}"]`)!;
    fireEvent.pointerEnter(tab);
    fireEvent.click(within(tab).getByRole("button", { name: "Close first" }));
    await waitFor(() => expect(screen.queryByRole("tab", { name: "first" })).toBeNull());
    expect(field().value).toBe("  second Project 東京\n ");
    fireEvent.click(screen.getByRole("button", { name: "Open a folder" }));
    await screen.findByRole("tab", { name: "first" });
    await waitFor(() => expect(field().value).toBe(exact));
    expect([field().selectionStart, field().selectionEnd, field().selectionDirection]).toEqual([2, 6, "backward"]);
    view.unmount();
    mount();
    await screen.findByRole("tab", { name: "first" });
    fireEvent.click(screen.getByRole("tab", { name: "first" }));
    await waitFor(() => expect(field().value).toBe(exact));
    expect(owners(real.dir).list().find(draft => draft.destination.surface === "ask")?.value.workstream).toBe(original.id);
    expect(calls.flatMap(spy => spy.mock.calls).filter(([method]) => method === "ask.send")).toEqual([]);
    expect(await first.rpc("ask.list", null)).toEqual(before);
    expect(await other.rpc("ask.list", null)).toEqual([]);
  } finally {
    cleanup();
    vi.restoreAllMocks();
    await second.stop();
  }
}, 120_000);
