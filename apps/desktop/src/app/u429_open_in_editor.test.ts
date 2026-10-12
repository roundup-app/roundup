import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, expect, it } from "vitest";
import { SEAM_COMMANDS } from "./seam";
import { createTauriApp } from "./tauri";

afterEach(clearMocks);

it("u429_the_command_is_in_the_seam_list_and_the_table", async () => {
  const seen: { command: string; args: unknown }[] = [];

  mockIPC((command, args) => {
    seen.push({ command, args });
  }, { shouldMockEvents: false });

  await createTauriApp().openInEditor("/p/wt");

  expect(SEAM_COMMANDS).toContain("open_in_editor");
  expect(seen).toEqual([{ command: "open_in_editor", args: { path: "/p/wt" } }]);
  expect(readFileSync(resolve(process.cwd(), "../../scenarios/app.md"), "utf8")).toContain("| `open_in_editor` |");
});
