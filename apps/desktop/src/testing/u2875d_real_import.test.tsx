// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { App } from "../App";
import { fakeEmulators } from "../terminal/paneHarness";
import { createServedApp } from "./realSeam";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";

const FIXTURES = resolve(process.cwd(), "../../crates/agents/tests/fixtures/import-2.1.300");

const SESSION = "00000001-1111-4111-8111-111111111111";

let real: StartedDaemon;

beforeEach(async () => { real = await startRealDaemon({}); }, 120_000);

afterEach(async () => {
  cleanup();
  await real?.stop();
});

const mount = () => {
  const app = createServedApp(real.base);

  render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);

  return app;
};

it("u2875d_real_import_reopen_and_resume", async () => {
  // The observed 2.1.300 conversation, re-rooted in this Project and dated now so the week period holds it.
  const recorded = await readFile(join(FIXTURES, "top-level.jsonl"), "utf8");
  const stamped = recorded.replaceAll("/fixture/project", real.dir).replace(/"timestamp":"[^"]+"/g, () => `"timestamp":"${new Date().toISOString()}"`);
  const bucket = join(real.dir, "claude-config", "projects", "bucket");

  await mkdir(bucket, { recursive: true });
  await writeFile(join(bucket, `${SESSION}.jsonl`), stamped);

  const app = mount();
  const before = (await app.rpc("rail.tree", null)).length;

  fireEvent.click(await screen.findByRole("button", { name: "Import Claude Code work" }));
  fireEvent.click((await screen.findAllByRole("checkbox"))[0]!);
  fireEvent.click(await screen.findByRole("button", { name: "Import 1" }));
  await waitFor(async () => expect((await app.rpc("rail.tree", null)).length).toBeGreaterThan(before), { timeout: 30_000 });

  const created = await app.rpc("rail.tree", null);
  const child = created.find((node) => node.kind === "agent")!;

  expect(child.status?.kind).not.toBe("running");

  // Reopen: the closed child survives a Daemon restart and offers Resume.
  cleanup();
  await real.restart();
  const reopened = mount();

  await waitFor(async () => expect((await reopened.rpc("rail.tree", null)).map((node) => node.id)).toContain(child.id), { timeout: 30_000 });
  const rail = await screen.findByRole("region", { name: "Rail" });

  fireEvent.click(await waitFor(() => rail.querySelector<HTMLElement>(`.rail-row[data-id="${child.id}"]`)!.querySelector("button, [role=button], span")!));
  expect(await screen.findByRole("button", { name: "Resume" }, { timeout: 30_000 })).toBeTruthy();
}, 240_000);
