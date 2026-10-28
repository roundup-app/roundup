import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, expect, it } from "vitest";
import { createTauriApp } from "./tauri";
import { RpcError } from "./seam";

afterEach(clearMocks);

it("u52_the_native_adapter_reads_both_facts_without_a_project", async () => {
  const paths = ["/repos/one", "/repos/two"];
  const binary = { path: "/fake/claude", version: "3.2.1" };
  const commands: string[] = [];
  mockIPC(command => {
    commands.push(command);

    return command === "recent_projects" ? paths : binary;
  });
  const app = createTauriApp();
  expect(await app.recentProjects()).toEqual(paths);
  expect(await app.claudeBinary()).toEqual(binary);
  expect(commands).toEqual(["recent_projects", "claude_binary"]);
});

it("u52_the_native_adapter_refuses_malformed_facts", async () => {
  mockIPC(() => ({ path: 7, version: "wrong" }));
  const app = createTauriApp();
  await expect(app.recentProjects()).rejects.toBeInstanceOf(RpcError);
  await expect(app.claudeBinary()).rejects.toBeInstanceOf(RpcError);
});
