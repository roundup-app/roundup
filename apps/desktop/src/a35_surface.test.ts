import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const THIS = "a35_surface.test.ts";
const WORDS = ["workstream.rewind", "rewindPlan", "U374"];

// A35: the generated contract types name the method; no hand-written App code calls it.
const handWritten = readdirSync(import.meta.dirname, {
  recursive: true,
  encoding: "utf8",
}).filter((path) => path !== THIS && !path.split("/").includes("generated"));

// A whole id only: U3740 is another scenario.
const names = (text: string, word: string) =>
  new RegExp(`${word.replace(".", "\\.")}(?!\\d)`).test(text);

it("a35_rewind_has_no_app_only_caller_or_u374_surface", () => {
  const found = handWritten.flatMap((path) => {
    let text: string;
    try {
      text = readFileSync(join(import.meta.dirname, path), "utf8");
    } catch {
      return []; // a directory
    }
    return WORDS.filter((word) => names(text, word)).map(
      (word) => `${path} names ${word}`,
    );
  });

  expect(found).toEqual([]);
});
