import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { waitFor } from "@solidjs/testing-library";
import { startRealDaemon } from "../testing/realDaemonFixture";
import { createServedApp } from "../testing/realSeam";

it("u4547b_creation_starts_with_the_saved_first_prompt", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mode-input-"));
  const log = join(dir, "prompts.jsonl");
  const real = await startRealDaemon({ FAKE_CLAUDE_PROMPT_LOG: log, FAKE_CLAUDE_EXACT_PROMPTS: "1" });

  try {
    const app = createServedApp(real.base);
    const node = await app.rpc("rail.createWorkstream", { name: "Review", parent: null });
    const prompt = "  Review e\u0301 🧭\nKeep spacing  ";
    await app.rpc("workstream.setOpeningPrompt", { id: node.id, prompt });
    await app.rpc("workstream.restart", { id: node.id, request: "create-mode" });
    const inputs = async () => (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line)).filter(entry => !entry.inbox);
    await waitFor(async () => expect(await inputs()).toEqual([{ resume: false, prompt }]), { timeout: 20_000 });
    await app.rpc("workstream.restart", { id: node.id, request: "create-mode" });
    expect(await inputs()).toEqual([{ resume: false, prompt }]);
    await app.rpc("workstream.setOpeningPrompt", { id: node.id, prompt: " changed for the next session\n " });
    expect(await inputs()).toEqual([{ resume: false, prompt }]);
  } finally { await real.stop(); await rm(dir, { recursive: true, force: true }); }
}, 180_000);

it("u4547c_saved_prompt_and_contents_survive_daemon_reopen", async () => {
  const real = await startRealDaemon({});

  try {
    const app = createServedApp(real.base);
    const node = await app.rpc("rail.createWorkstream", { name: "Review", parent: null });
    const child = await app.rpc("todo.create", { title: "Retained task", body: "", blockers: [] });
    await app.rpc("todo.move", { id: child.id, home: node.id });
    const prompt = "  exact first prompt\n ";
    await app.rpc("workstream.setOpeningPrompt", { id: node.id, prompt });
    await real.restart();
    const reopened = createServedApp(real.base);
    const tree = await reopened.rpc("rail.tree", null);
    expect(tree.find(row => row.id === node.id)).toMatchObject({ id: node.id, name: "Review", opening_prompt: prompt, terminal_id: null });
    expect((await reopened.rpc("todo.list", null)).find(row => row.id === child.id)).toMatchObject({ home: node.id, title: "Retained task" });
  } finally { await real.stop(); }
}, 180_000);
