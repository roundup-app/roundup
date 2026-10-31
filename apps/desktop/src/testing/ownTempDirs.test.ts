import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { removeOwnTempDirs } from "./ownTempDirs";

test("ci5330b_a_files_teardown_removes_the_temporary_directories_it_made", async () => {
  const profile = mkdtempSync(join(tmpdir(), "ci5330b-profile-"));
  const captures = await mkdtemp(join(tmpdir(), "ci5330b-captures-"));

  writeFileSync(join(profile, "trace.zip"), "x");
  removeOwnTempDirs();
  expect(existsSync(profile)).toBe(false);
  expect(existsSync(captures)).toBe(false);
});
