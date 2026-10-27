import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, expect, it } from "vitest";
import type { CatchUp } from "@contracts/terminal/CatchUp";
import { createTauriApp } from "./tauri";

afterEach(clearMocks);

it("z3788a_catch_up_keeps_the_captured_project_and_binary_reply", async () => {
  const calls: unknown[] = [];
  const replay: CatchUp = { kind: "contiguous", id: "7", incarnation: "original", from: 3, after: 6, data: "AP8b" };
  mockIPC((command, args) => {
    calls.push({ command, args });
    return replay;
  });
  const app = createTauriApp();
  const original = app.forProject("/original");
  app.forProject("/other");
  await expect(original.rpc("terminal.catchUp", { id: "7", incarnation: "original", after: 3 })).resolves.toEqual(replay);
  expect(calls).toEqual([{ command: "rpc", args: {
    path: "/original", method: "terminal.catchUp", params: { id: "7", incarnation: "original", after: 3 },
  } }]);
});
