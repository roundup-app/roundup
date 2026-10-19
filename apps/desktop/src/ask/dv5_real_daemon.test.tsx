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
