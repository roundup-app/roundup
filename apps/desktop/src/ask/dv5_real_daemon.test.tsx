// @vitest-environment jsdom
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { ConnectedProjectContext, connectProject } from "../state/connectedProject";
import { createServedApp } from "../testing/realSeam";
import { startRealDaemon, type StartedDaemon } from "../testing/realDaemonFixture";
import type { OpenTarget } from "../app/seam";
import { AskBar } from "./AskBar";

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
  await writeFile(join(real.dir, "result.txt"), "new bytes");
  await real.restart();
  const opened: OpenTarget[] = [];
  app.openTarget = async target => { opened.push(target); };
  const connected = await connectProject(app, { path: real.dir, name: "Project" }, () => false, () => 0);
  render(() => <ConnectedProjectContext.Provider value={connected}><AskBar /></ConnectedProjectContext.Provider>);
  const made = await screen.findByRole("region", { name: "Made" });
  const rows = await within(made).findAllByRole("listitem");
  expect(rows).toHaveLength(2);
  const file = rows.find(row => row.textContent?.includes("result.txt"))!;
  expect(file.textContent).toContain("Made Home");
  fireEvent.click(within(file).getByRole("button"));
  await waitFor(() => expect(made.getAttribute("aria-busy")).toBe("false"));
  expect(opened).toHaveLength(1);
  const target = opened[0]!;
  expect(target.kind).toBe("path");
  if (target.kind === "path") expect(await readFile(target.path, "utf8")).toBe("published bytes");
  const external = rows.find(row => row !== file)!;
  fireEvent.click(within(external).getByRole("button"));
  await waitFor(() => expect(made.getAttribute("aria-busy")).toBe("false"));
  expect(opened[1]).toEqual({ kind: "url", url: "https://example.com/exact?revision=1" });
  expect(link.id).not.toBe(record.id);
  connected.rail.select(home.id);
  await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
});
