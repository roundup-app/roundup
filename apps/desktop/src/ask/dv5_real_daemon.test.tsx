// @vitest-environment jsdom
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { ConnectedProjectContext, connectProject } from "../state/connectedProject";
import { createServedApp } from "../testing/realSeam";
import { startRealDaemon, type StartedDaemon } from "../testing/realDaemonFixture";
import { RpcError } from "../app/seam";
import type { OpenTarget } from "../app/seam";
import { AskBar } from "./AskBar";

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
  const padRecord = await app.rpc("deliverable.publish", { key: "pad", title: "Same title", target: { kind: "pad", name: pad.name, incarnation: pad.incarnation, revision: pad.revision } });
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
  connected.showView("made");
  render(() => <ConnectedProjectContext.Provider value={connected}><AskBar /></ConnectedProjectContext.Provider>);
  const made = await screen.findByRole("region", { name: "Made" });
  const rows = await within(made).findAllByRole("listitem");
  expect(rows).toHaveLength(13);
  const file = rows.find(row => row.getAttribute("data-deliverable") === record.id)!;

  fireEvent.click(within(file).getByRole("button"));
  await waitFor(() => expect(made.getAttribute("aria-busy")).toBe("false"));
  expect(opened).toHaveLength(1);
  const target = opened[0]!;
  expect(target.kind).toBe("path");

  if (target.kind === "path") expect(await readFile(target.path, "utf8")).toBe("published bytes");
  const external = rows.find(row => row.getAttribute("data-deliverable") === link.id)!;
  fireEvent.click(within(external).getByRole("button"));
  await waitFor(() => expect(made.getAttribute("aria-busy")).toBe("false"));
  expect(opened[1]).toEqual({ kind: "url", url: "https://example.com/exact?revision=1" });
  expect(link.id).not.toBe(record.id);
  const publishedPad = rows.find(row => row.getAttribute("data-deliverable") === padRecord.id)!;
  fireEvent.click(within(publishedPad).getByRole("button"));
  await waitFor(() => expect(made.getAttribute("aria-busy")).toBe("false"));
  const padTarget = opened[2]!;
  expect(padTarget.kind).toBe("path");

  if (padTarget.kind === "path") expect(await readFile(padTarget.path, "utf8")).toBe("Pad revision one");
  expect((await app.rpc("pad.read", { name: "published-pad" })).text).toBe("Pad revision two");
  expect(calls.filter(method => method.startsWith("agent.") || method.startsWith("message."))).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: /^Filter Made/ }));
  fireEvent.click(await screen.findByRole("option", { name: "Made Home" }));
  await waitFor(() => expect(within(screen.getByRole("region", { name: "Made" })).getAllByRole("listitem")).toHaveLength(6));
  fireEvent.click(screen.getByRole("button", { name: /^Filter Made/ }));
  fireEvent.click(await screen.findByRole("option", { name: "Maker 0" }));
  await waitFor(() => expect(within(screen.getByRole("region", { name: "Made" })).getAllByRole("listitem")).toHaveLength(1));
});

it("dv5_open_failure_preserves_catalogue_selection_and_refuses_removed_or_revoked_cached_targets", async () => {
  const app = createServedApp(real.base);
  const link = await app.rpc("deliverable.publish", { key: "failure-link", title: "Failure link", target: { kind: "external", url: "https://example.com/refused" } });
  await app.rpc("pad.create", { name: "revoked-pad", text: "retained secret" });
  const source = await app.rpc("pad.read", { name: "revoked-pad" });
  await app.rpc("deliverable.publish", { key: "failure-pad", title: "Failure Pad", target: { kind: "pad", name: "revoked-pad", incarnation: source.incarnation, revision: source.revision } });
  await writeFile(join(real.dir, "removed-cache.txt"), "cached revision");
  const file = await app.rpc("deliverable.publish", { key: "removed-cache", title: "Cached file", target: { kind: "file", path: "removed-cache.txt" } });
  const opened: OpenTarget[] = [];
  let refusal: string | null = "external opener refused";
  app.openTarget = async target => { opened.push(target);

 if (refusal) throw new Error(refusal); };

  const connected = await connectProject(app, { path: real.dir, name: "Project" }, () => false, () => 0);
  connected.showView("made");
  render(() => <ConnectedProjectContext.Provider value={connected}><AskBar /></ConnectedProjectContext.Provider>);
  const made = await screen.findByRole("region", { name: "Made" });
  const linkButton = await within(made).findByRole("button", { name: new RegExp(`^Open Failure link$`) });
  // P3557c: a failure belongs to its record, so each row is read on its own.
  const rowOf = (button: HTMLElement) => button.closest("li")!;
  const count = within(made).getAllByRole("listitem").length;
  linkButton.focus();
  fireEvent.click(linkButton);
  await waitFor(() => expect(made.getAttribute("aria-busy")).toBe("false"));

  expect(document.activeElement).toBe(linkButton);
  expect(linkButton.getAttribute("aria-current")).toBe("true");
  expect(within(made).getAllByRole("listitem")).toHaveLength(count);
  expect(opened).toEqual([{ kind: "url", url: "https://example.com/refused" }]);

  const padButton = within(made).getByRole("button", { name: new RegExp(`^Open Failure Pad$`) });
  refusal = "native opener refused";
  fireEvent.click(padButton);
  await waitFor(() => expect(made.getAttribute("aria-busy")).toBe("false"));

  expect(opened).toHaveLength(2);
  const cached = opened[1]!;
  expect(cached.kind).toBe("path");
  await app.rpc("pad.delete", { name: "revoked-pad" });
  refusal = null;
  fireEvent.click(padButton);
  await waitFor(() => expect(made.getAttribute("aria-busy")).toBe("false"));
  expect(opened).toHaveLength(2);
  expect(within(rowOf(padButton)).getByRole("alert")).toBeDefined();
  expect(within(made).getAllByRole("listitem")).toHaveLength(count);

  const fileButton = within(made).getByRole("button", { name: new RegExp(`^Open Cached file$`) });
  fireEvent.click(fileButton);
  await waitFor(() => expect(made.getAttribute("aria-busy")).toBe("false"));
  expect(opened).toHaveLength(3);
  const cachedFile = opened[2]!;
  expect(cachedFile.kind).toBe("path");
  await app.rpc("deliverable.remove", { project: file.project, id: file.id });
  await waitFor(() => expect(within(made).getAllByRole("listitem").map(row => row.getAttribute("data-deliverable"))).not.toContain(file.id));
  await expect(app.rpc("deliverable.resolve", { project: file.project, id: file.id })).rejects.toThrow();
  expect(opened).toHaveLength(3);

  if (cachedFile.kind === "path") await expect(readFile(cachedFile.path)).rejects.toThrow();
  await app.rpc("deliverable.remove", { project: link.project, id: link.id });
  await waitFor(() => expect(within(made).getAllByRole("listitem").map(row => row.getAttribute("data-deliverable"))).not.toContain(link.id));
  await expect(app.rpc("deliverable.resolve", { project: link.project, id: link.id })).rejects.toThrow();
  expect(opened).toHaveLength(3);
  expect(within(made).getAllByRole("listitem")).toHaveLength(count - 2);
  expect(connected.rail.selected()).toBeNull();
  await expect(app.rpc("deliverable.publish", { key: "unsafe", title: "Unsafe", target: { kind: "external", url: "roundup://anything" } })).rejects.toThrow();
  expect(opened).toHaveLength(3);
  // A malformed upstream external resolution still cannot reach the native opener.
  const unsafe = vi.spyOn(app, "rpc").mockResolvedValueOnce({ kind: "external", url: "javascript:alert(1)", availability: "not-checked" });
  fireEvent.click(padButton);
  await waitFor(() => expect(made.getAttribute("aria-busy")).toBe("false"));
  expect(opened).toHaveLength(3);
  expect(within(rowOf(padButton)).getByRole("alert")).toBeDefined();
  unsafe.mockRestore();
  const rpc = app.rpc;
  app.rpc = (method, params) => method === "deliverable.list" ? Promise.reject(new Error("catalogue connection interrupted")) : rpc(method, params);
  await rpc("deliverable.publish", { key: "reload-failure", title: "Reload signal", target: { kind: "external", url: "https://example.com/reload" } });
  await waitFor(() => expect(within(made).getAllByRole("alert").some(alert => alert.textContent?.includes("catalogue connection interrupted"))).toBe(true));
  expect(within(made).getAllByRole("listitem")).toHaveLength(count - 2);
  expect(within(made).getByRole("button", { name: /^Open Failure Pad$/ }).getAttribute("aria-current")).toBe("true");
  app.rpc = rpc;
  cleanup();
  await real.restart();
  const reopened = await connectProject(app, { path: real.dir, name: "Project" }, () => false, () => 0);
  reopened.showView("made");
  render(() => <ConnectedProjectContext.Provider value={reopened}><AskBar /></ConnectedProjectContext.Provider>);
  const catalogue = await screen.findByRole("region", { name: "Made" });
  await within(catalogue).findByRole("button", { name: new RegExp(`^Open Failure Pad$`) });
  expect(within(catalogue).queryByRole("button", { name: new RegExp("^Open Cached file$") })).toBeNull();
  expect(within(catalogue).queryByRole("button", { name: new RegExp("^Open Failure link$") })).toBeNull();
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


it("dv6_bound_share_copies_the_selected_publication_and_resolves_its_retained_revision", async () => {
  const app = createServedApp(real.base);
  await app.rpc("pad.create", { name: "share-pad", text: "published exact revision 🌿" });
  const pad = await app.rpc("pad.read", { name: "share-pad" });
  const published = await app.rpc("deliverable.publish", { key: "share-pad", title: "Duplicate title", target: { kind: "pad", name: pad.name, incarnation: pad.incarnation, revision: pad.revision } });
  const external = await app.rpc("deliverable.publish", { key: "share-external", title: "Duplicate title", target: { kind: "external", url: "https://example.com/exact?revision=1" } });
  await app.rpc("pad.write", { name: pad.name, text: "mutable replacement", expectedRevision: pad.revision });
  await real.restart();
  const reader = await app.rpc("agent.spawn", { cwd: real.dir, parent: null, prompt: null, name: "Link reader" });
  const copied: string[] = [];
  vi.spyOn(app, "writeClipboardText").mockImplementation(async (text: string) => { copied.push(text); });
  app.showContextMenu = vi.fn(async () => "copy-link");
  const connected = await connectProject(app, { path: real.dir, name: "Project" }, () => false, () => 0);
  connected.showView("made");
  render(() => <ConnectedProjectContext.Provider value={connected}><AskBar /></ConnectedProjectContext.Provider>);
  const made = await screen.findByRole("region", { name: "Made" });

  for (const [index, record] of [published, external, published].entries()) {
    const row = await waitFor(() => {
      const found = made.querySelector<HTMLElement>(`[data-deliverable="${record.id}"]`);

      if (!found) throw new Error("Publication row is not loaded");

      return found;
    });

    const button = await within(row).findByRole("button");
    button.focus();

    if (index === 0) fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    else fireEvent.keyDown(button, index === 1 ? { key: "ContextMenu" } : { key: "F10", shiftKey: true });
    expect(app.showContextMenu).toHaveBeenCalledTimes(index + 1);
    await waitFor(() => expect(copied).toHaveLength(index + 1));
    const reference = copied.at(-1)!;
    const url = reference.split("\n")[0]!;
    expect(reference.split("\n")[1]).toBe(`rup link read ${url}`);
    expect(url).toBe(`roundup://deliverable/${record.id}?project=${record.project}`);
    const { stdout } = await exec(resolve("../../target/debug/rup"), ["--json", "--agent", reader.id, "link", "read", url], { env: { ...process.env, RUPD_SOCKET: join(real.dir, "rupd.sock") } });
    const content = JSON.parse(stdout);
    expect(content).toMatchObject({ kind: "deliverable", record });

    if (record === published) {
      expect(content.resolution.kind).toBe("retained");
      expect(await readFile(content.resolution.path, "utf8")).toBe("published exact revision 🌿");
    } else expect(content.resolution).toEqual({ kind: "external", url: "https://example.com/exact?revision=1", availability: "not-checked" });
  }
});


it("dv6_bound_share_refuses_foreign_wrong_removed_and_revoked_identities_without_substitution", async () => {
  const app = createServedApp(real.base);
  const second = await startRealDaemon({});
  const other = createServedApp(second.base);

  try {
    await app.rpc("pad.create", { name: "revoked-share", text: "original protected revision" });
    const pad = await app.rpc("pad.read", { name: "revoked-share" });
    const original = await app.rpc("deliverable.publish", { key: "revoked-share", title: "Same", target: { kind: "pad", name: pad.name, incarnation: pad.incarnation, revision: pad.revision } });
    const replacement = await other.rpc("deliverable.publish", { key: "same", title: "Same", target: { kind: "external", url: "https://example.com/foreign" } });
    const url = `roundup://deliverable/${original.id}?project=${original.project}`;
    await expect(other.rpc("link.read", { url })).rejects.toThrow();

    for (const wrong of [
      `roundup://deliverable/missing?project=${original.project}`,
      `roundup://deliverable/${replacement.id}?project=${original.project}`,
      `roundup://deliverable/${original.id}?project=${replacement.project}`,
      `roundup://deliverable/${original.id}?project=${(await app.rpc("daemon.ping", null)).projectKey}`,
    ]) await expect(app.rpc("link.read", { url: wrong })).rejects.toThrow();
    await app.rpc("pad.delete", { name: pad.name });
    await app.rpc("pad.create", { name: pad.name, text: "different object with the same name" });
    await real.restart();
    expect(await app.rpc("link.read", { url })).toMatchObject({ kind: "deliverable", record: original, resolution: { kind: "unavailable", cause: "access-revoked" } });
    await app.rpc("deliverable.remove", { project: original.project, id: original.id });
    await real.restart();
    await expect(app.rpc("link.read", { url })).rejects.toThrow();
    const reader = await other.rpc("agent.spawn", { cwd: second.dir, parent: null, prompt: null, name: "Link reader" });
    const { stdout } = await exec(resolve("../../target/debug/rup"), ["--json", "--agent", reader.id, "link", "read", `roundup://deliverable/${replacement.id}?project=${replacement.project}`], { env: { ...process.env, RUPD_SOCKET: join(second.dir, "rupd.sock") } });
    expect(JSON.parse(stdout)).toMatchObject({ record: replacement, resolution: { kind: "external", url: "https://example.com/foreign" } });
  } finally {
    await second.stop();
  }
});

it("dv6_guarded_send_retries_the_same_identity_through_existing_pending_delivery", async () => {
  const logs = await mkdtemp(join(tmpdir(), "dv6-delivery-"));
  const log = join(logs, "prompts.jsonl");
  const delivery = await startRealDaemon({ FAKE_CLAUDE_PROMPT_LOG: log });
  const app = createServedApp(delivery.base);

  try {
    const publication = await app.rpc("deliverable.publish", { key: "send", title: "Same", target: { kind: "external", url: "https://example.com/selected" } });
    await app.rpc("deliverable.publish", { key: "other", title: "Same", target: { kind: "external", url: "https://example.com/other" } });
    const receiver = await app.rpc("agent.spawn", { cwd: delivery.dir, parent: null, prompt: null, name: "Reader", order: { kind: "work", ask: "Read selected publication", limits: [] } });
    await waitFor(async () => expect((await app.rpc("rail.tree", null)).find(node => node.id === receiver.id)?.status?.kind).toBe("idle"));
    const connected = await connectProject(app, { path: delivery.dir, name: "Project" }, () => false, () => 0);
    await connected.rail.settled();
    connected.showView("made");
  render(() => <ConnectedProjectContext.Provider value={connected}><AskBar /></ConnectedProjectContext.Provider>);
    const made = await screen.findByRole("region", { name: "Made" });

    const row = await waitFor(() => {
      const found = made.querySelector<HTMLElement>(`[data-deliverable="${publication.id}"]`);

      if (!found) throw new Error("Publication row is not loaded");

      return found;
    });

    const messages = async () => (await app.rpc("message.list", { to: receiver.id, status: null })).filter(message => message.from.kind === "user");
    let choice: string | null = null;
    app.showContextMenu = vi.fn(async () => choice);
    const rpc = app.rpc;
    const sends: unknown[] = [];
    let refuse = true;
    let interrupted = true;

    app.rpc = (method, params) => {
      if (method === "deliverable.resolve" && interrupted) return Promise.reject(new Error("publication read interrupted"));

      if (method === "message.send") {
        sends.push(params);

        if (refuse) return Promise.reject(new Error("send refused before acceptance"));
      }

      return rpc(method, params);
    };

    const button = within(row).getByRole("button");
    button.focus();
    fireEvent.keyDown(button, { key: "ContextMenu" });
    expect(app.showContextMenu).toHaveBeenCalledTimes(1);
    expect(await messages()).toEqual([]);
    expect(sends).toEqual([]);
    choice = `send:${receiver.id}`;
    fireEvent.keyDown(button, { key: "F10", shiftKey: true });
    await within(row).findByRole("alert");
    expect(sends).toEqual([]);
    interrupted = false;
    fireEvent.contextMenu(row);
    await waitFor(() => expect(sends).toHaveLength(1));
    await within(row).findByRole("alert");
    expect(await messages()).toEqual([]);
    await app.rpc("terminal.write", { id: receiver.terminal_id!, data: Buffer.from("unfinished user input").toString("base64") });
    refuse = false;
    fireEvent.contextMenu(row);
    await waitFor(async () => expect(await messages()).toHaveLength(1));
    const accepted = (await messages())[0]!;
    const url = `roundup://deliverable/${publication.id}?project=${publication.project}`;
    expect(accepted).toMatchObject({ to: receiver.id, body: `${url}\nrup link read ${url}`, kind: "note" });
    expect(sends).toHaveLength(2);
    expect(sends[0]).toEqual(sends[1]);
    await waitFor(async () => expect((await messages())[0]?.status).toBe("delivered"));
    expect((await messages())[0]?.body).toBe(accepted.body);
    // The unsent input does not hold it, and it reaches the receiver's inbox, never its Terminal.
    // SAFETY: the fake Claude writes exactly these fields to its prompt log.
    const taken = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line) as { prompt: string; inbox?: string });
    expect(taken.filter(line => line.prompt.includes(url)).map(line => line.inbox)).toEqual([`rup-${accepted.id}`]);
    await app.rpc("deliverable.remove", { project: publication.project, id: publication.id });
    await waitFor(() => expect(document.querySelector(`[data-deliverable="${publication.id}"]`)).toBeNull());
    await expect(app.rpc("deliverable.get", { project: publication.project, id: publication.id })).rejects.toThrow();
    expect(sends).toHaveLength(2);
    expect(await messages()).toHaveLength(1);
  } finally {
    cleanup();
    await delivery.stop();
    await rm(logs, { recursive: true, force: true });
  }
});


it("u5558a_publication_appears_without_input", async () => {
  const app = createServedApp(real.base);
  const maker = await app.rpc("agent.spawn", { cwd: real.dir, prompt: null, parent: null, name: "Automatic maker" });
  const connected = await connectProject(app, { path: real.dir, name: "Project" }, () => false, () => 0);
  connected.showView("made");
  render(() => <ConnectedProjectContext.Provider value={connected}><AskBar /></ConnectedProjectContext.Provider>);
  const made = await screen.findByRole("region", { name: "Made" });
  const rpc = app.rpc;
  let reads = 0;
  app.rpc = (method, params) => { if (method === "deliverable.list") reads++;

 return rpc(method, params); };

  await exec(resolve("../../target/debug/rup"), ["deliverable", "publish", "automatic", "Automatic result", "--agent", maker.id, "--target", JSON.stringify({ kind: "external", url: "https://example.com/automatic" })], { env: { ...process.env, RUPD_SOCKET: join(real.dir, "rupd.sock") } });
  const record = (await rpc("deliverable.list", { home: null, maker: maker.id }))[0]!;
  await waitFor(() => expect(within(made).getAllByRole("listitem").map(row => row.getAttribute("data-deliverable"))).toContain(record.id));
  expect(reads).toBe(1);
});

it("u5558a_removal_disappears_without_input", async () => {
  const app = createServedApp(real.base);
  const records: Awaited<ReturnType<typeof app.rpc<"deliverable.publish">>>[] = [];

  for (const key of ["first-auto", "second-auto"]) records.push(await app.rpc("deliverable.publish", { key, title: "Duplicate automatic title", target: { kind: "external", url: `https://example.com/${key}` } }));
  const connected = await connectProject(app, { path: real.dir, name: "Project" }, () => false, () => 0);
  connected.showView("made");
  render(() => <ConnectedProjectContext.Provider value={connected}><AskBar /></ConnectedProjectContext.Provider>);
  const made = await screen.findByRole("region", { name: "Made" });
  await waitFor(() => expect(within(made).getAllByRole("listitem").map(row => row.getAttribute("data-deliverable"))).toContain(records[0]!.id));
  const rpc = app.rpc;
  let reads = 0;
  app.rpc = (method, params) => { if (method === "deliverable.list") reads++;

 return rpc(method, params); };

  await app.rpc("deliverable.remove", { project: records[0]!.project, id: records[0]!.id });
  await waitFor(() => expect(within(made).getAllByRole("listitem").map(row => row.getAttribute("data-deliverable"))).not.toContain(records[0]!.id));
  expect(within(made).getAllByRole("listitem").map(row => row.getAttribute("data-deliverable"))).toContain(records[1]!.id);
  expect(reads).toBe(1);
});
