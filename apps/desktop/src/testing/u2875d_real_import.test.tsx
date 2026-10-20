// @vitest-environment jsdom
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { App } from "../App";
import type { AppSeam } from "../app/seam";
import { fakeEmulators } from "../terminal/paneHarness";
import { createServedApp } from "./realSeam";
import { withProjectPair } from "./realDaemonFixture";

afterEach(() => { cleanup(); localStorage.clear(); });

it("u2875d_real_import_reopen_and_resume", async () => {
  await withProjectPair(async (real, other) => {
    try {
      const ID = "22222222-2222-4222-8222-222222222222";
      const bucket = join(real.dir, "claude-config", "projects", "bucket");
      await mkdir(bucket, { recursive: true });
      const cwd = await realpath(real.dir);
      const record = (type: string, extra: { message?: { role: string; content: string }; customTitle?: string }) => JSON.stringify({ type, isSidechain: false, cwd, sessionId: ID, timestamp: new Date().toISOString(), ...extra });
      await writeFile(join(bucket, `${ID}.jsonl`), [
        record("user", { message: { role: "user", content: "never sent" } }),
        record("custom-title", { customTitle: "Imported 東京 work" }),
      ].join("\n") + "\n");

      const app: AppSeam = createServedApp(real.base);
      const emulators = fakeEmulators();
      render(() => <App app={app} reducedMotion={() => true} clock={Date.now} createEmulator={emulators.factory} />);

      fireEvent.click(await screen.findByRole("button", { name: "Import Claude Code work" }));
      fireEvent.click(await screen.findByText("Imported 東京 work"));
      fireEvent.click(await screen.findByRole("button", { name: "Import 1" }));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Import Claude Code work" })).toBeNull());

      const created = async () => {
        const tree = await app.rpc("rail.tree", null);
        const workstream = tree.find((node) => node.kind === "workstream" && node.name === "Imported 東京 work");
        const child = tree.find((node) => node.kind !== "workstream" && node.name === "Imported 東京 work");

        return { workstream, child };
      };

      expect(await createServedApp(other.base).rpc("rail.tree", null)).toEqual([]);

      const first = await created();
      expect(first.workstream).toBeTruthy();
      expect(first.child?.can_resume).toBe(true);
      expect(await app.rpc("terminal.list", null)).toEqual([]);

      cleanup();

      // Reopen: the same nodes, still closed, still resumable, never launched.
      await real.restart();
      const again = await created();
      expect(again.workstream?.id).toBe(first.workstream?.id);
      expect(again.child?.id).toBe(first.child?.id);
      expect(again.child?.can_resume).toBe(true);
      expect(await app.rpc("terminal.list", null)).toEqual([]);

      // Reopening the App shows the Workstream with its closed child offering Resume, and starts nothing.
      render(() => <App app={createServedApp(real.base)} reducedMotion={() => true} clock={Date.now} createEmulator={emulators.factory} />);
      await waitFor(() => expect(document.querySelector(`[data-id="${again.child?.id}"] button[aria-label=Resume]`)).toBeTruthy());
      expect(await app.rpc("terminal.list", null)).toEqual([]);
    } finally {
      cleanup();
    }
  });
}, 120_000);
