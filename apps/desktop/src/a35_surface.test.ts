import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const THIS = "a35_surface.test.ts";

// A whole id only: U3740 is another scenario.
const NAMED = /workstream\.rewind(?!\d)|rewindPlan(?!\d)|U374(?!\d)/g;

// A35: the generated contract types name the method; no hand-written App code calls it.
const handWritten = readdirSync(import.meta.dirname, {
  recursive: true,
  encoding: "utf8",
}).filter(
  (path) =>
    path !== THIS &&
    !path.split("/").includes("generated") &&
    statSync(join(import.meta.dirname, path)).isFile(),
);

it("a35_rewind_has_no_app_only_caller_or_u374_surface", () => {
  const found = handWritten.flatMap((path) => {
    const words =
      readFileSync(join(import.meta.dirname, path), "utf8").match(NAMED) ?? [];

    return words.map((word) => `${path} names ${word}`);
  });

  expect(found).toEqual([]);
});
