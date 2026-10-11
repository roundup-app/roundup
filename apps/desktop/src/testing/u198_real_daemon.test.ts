// @vitest-environment jsdom
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServedApp } from "./realSeam";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";

let real: StartedDaemon;

const skill = (base: string, name: string) => {
  mkdirSync(join(base, ".claude/skills", name), { recursive: true });
  writeFileSync(join(base, ".claude/skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: does ${name}\n---\n`);
};

beforeEach(async () => {
  const home = mkdtempSync(join(tmpdir(), "u198-home-"));

  for (const name of ["reduce", "model", "effort", "compact", "clear"]) skill(home, name);

  real = await startRealDaemon({ HOME: home });
}, 120_000);

afterEach(async () => {
  await real?.stop();
});

describe("u198 the real Daemon lists Skills", () => {
  it("u198_the_list_holds_the_fixture_skills_and_no_banned_command", async () => {
    const app = createServedApp(real.base);
    const workstream = await app.rpc("rail.createWorkstream", { name: "ws", parent: null });

    const { skills } = await app.rpc("agent.skills", { id: workstream.id });

    expect(skills.map((each) => each.name)).toEqual(["reduce"]);
    expect(skills[0]?.description).toBe("does reduce");
  }, 120_000);
});
