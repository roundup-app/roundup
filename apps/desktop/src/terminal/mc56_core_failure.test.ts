import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { coreFailureAction, coreFailureCodes, coreFailureLabel } from "./coreFailure";

/** The Avoid words of GLOSSARY.md's tables, as `loop/rules.sh vocab` reads them: a cell ends at its first `.` or `;`. */
const avoidWords = (): string[] => {
  const lines = readFileSync(resolve(process.cwd(), "../../GLOSSARY.md"), "utf8").split("\n");
  const words: string[] = [];
  let inTable = false;

  for (const line of lines) {
    if (/^\| *Code term *\| *User label *\| *Avoid *\|/.test(line)) { inTable = true; continue; }

    if (!line.startsWith("|")) { inTable = false; continue; }

    const cell = line.split("|")[3]?.split(/[.;]/)[0] ?? "";

    if (inTable) for (const word of cell.split(",")) if (word.trim() && word.trim() !== "—") words.push(word.trim().toLowerCase());
  }

  return words;
};

describe("MC56", () => {
  it("mc56_each_core_failure_has_an_app_label", () => {
    const avoid = avoidWords();
    expect(avoid.length).toBeGreaterThan(0);
    expect(coreFailureCodes).toEqual(["core_missing", "unsupported_generation", "core_closed", "core_silent", "core_error", "core_protocol", "core_io"]);

    for (const text of [...coreFailureCodes.map(coreFailureLabel), coreFailureLabel("anything_else"), coreFailureAction]) {
      const lower = text.toLowerCase();
      expect(lower).not.toContain("herdr");
      expect(lower).not.toMatch(/core_|-32000|generation/);

      for (const word of avoid) expect(lower, word).not.toMatch(new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`));
    }
  });
});
