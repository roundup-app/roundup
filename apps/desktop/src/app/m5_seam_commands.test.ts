import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SEAM_COMMANDS } from "./seam";

describe("m5 every App action has a tool or a reason", () => {
  it("m5_every_command_the_adapter_invokes_is_in_seam_commands", () => {
    const source = readFileSync("src/app/tauri.ts", "utf8");
    const used = [...source.matchAll(/(?:command|parsedCommand)\((?:[^"()]*,\s*)?"([a-z_]+)"/g)].map((match) => match[1]);

    expect(used.length).toBeGreaterThan(0);

    const known: readonly (string | undefined)[] = SEAM_COMMANDS;

    for (const name of used) expect(known).toContain(name);
  });
});
