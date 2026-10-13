import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { SEAM_COMMANDS } from "../app/seam";
import { createFakeApp } from "../testing/fakeApp";

it("u429_the_command_is_in_the_seam_list_and_the_table", async () => {
  expect(SEAM_COMMANDS).toContain("open_in_editor");
  const table = readFileSync(resolve(process.cwd(), "../../scenarios/app.md"), "utf8");
  expect(table).toMatch(/\| `open_in_editor` \|/);
  const app = createFakeApp();
  await app.openInEditor("/p");
  expect(app.editorOpened).toEqual(["/p"]);
});
