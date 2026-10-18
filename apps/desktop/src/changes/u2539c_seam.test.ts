import { expect, it } from "vitest";
import { SEAM_COMMANDS } from "../app/seam";
import { createFakeApp } from "../testing/fakeApp";

it("u2539c_the_command_is_in_the_seam_list", async () => {
  expect(SEAM_COMMANDS).toContain("open_in_editor");
  const app = createFakeApp();
  await app.openInEditor("/p/a.ts", 7);
  await app.openInEditor("/p");
  expect(app.editorCalls).toEqual([{ path: "/p/a.ts", line: 7 }, { path: "/p" }]);
});
