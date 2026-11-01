// U198’s description parsing and workstream resolution remain in Rust. This
// inventoried real-Daemon fixture now proves U5483c’s Adapter → Rail path.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { cleanup, render, waitFor } from "@solidjs/testing-library";
import { createComponent, createSignal } from "solid-js";
import { expect, it } from "vitest";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { startRealDaemon } from "../testing/realDaemonFixture";
import { createServedApp } from "../testing/realSeam";
import { Rail } from "../rail/Rail";
import { rowNames } from "../rail/railFixture";

it("u5483c_adapter_question_stays_visible_until_work_resumes", async () => {
  // Use the same vendor as rupd's b50_note_inbox observer: a real PTY,
  // messaging socket, hook commands and a byte log, with no model involved.
  const vendor = await mkdtemp(join(tmpdir(), "u5483-vendor-"));
  const binary = join(vendor, "claude");
  await writeFile(binary, await readFile(resolve("../../crates/rupd/tests/support/fake_claude.txt")), { mode: 0o755 });
  await writeFile(join(vendor, "protocol"), "1");
  const real = await startRealDaemon({ ROUNDUP_CLAUDE_BIN: binary });

  try {
    const app = createServedApp(real.base);
    const calls: string[] = [];
    const rpc = app.rpc;
    app.rpc = (method, params) => { calls.push(method); return rpc(method, params); };
    const questions: unknown[] = [];
    app.ask = async question => { questions.push(question); return false; };
    const home = await app.rpc("rail.createWorkstream", { name: "Home", parent: null });
    const child = await app.rpc("agent.spawn", { name: "Child", cwd: real.dir, parent: home.id, prompt: null });
    await waitFor(async () => {
      const terminal = await app.rpc("terminal.read", { id: child.terminal_id!, after: 0, reader: null, max: null });
      expect(terminal.text).toContain("READY");
    });
    const [now, setNow] = createSignal(Date.now());
    const connected = await connectProject(app, { name: "Project", path: real.dir }, () => true, now);
    render(() => createComponent(ConnectedProjectContext.Provider, { value: connected, get children() { return createComponent(Rail, {}); } }));
    await waitFor(() => expect(rowNames()).toContain("Child"));
    const typed = () => readFile(join(vendor, "typed.bin")).catch(error => {
      if (error.code === "ENOENT") return Buffer.alloc(0);
      throw error;
    });
    const before = await typed();
    const callStart = calls.length;
    const signal = (payload: Record<string, unknown>) => app.rpc("agent.signal", { id: child.id, attempt: child.attempt!, payload });

    // Real Adapter input classes, including a question beyond a displayed excerpt.
    // The Rail never receives or inspects these strings.
    const replies = ["Should I publish three pages or five", "Published the pages", `${"Context line\n".repeat(80)}Should I publish three pages or five`, undefined, ""];

    for (const [turn, reply] of replies.entries()) {
      const promptId = `u5483-${turn}`;
      await signal({ hook_event_name: "UserPromptSubmit", prompt_id: promptId, prompt: "Continue" });
      await waitFor(() => expect(connected.rail.nodes.find(node => node.id === child.id)?.status?.kind).toBe("working"));
      expect(rowNames()).toContain("Child");
      await signal({ hook_event_name: "Stop", prompt_id: promptId, ...(reply === undefined ? {} : { last_assistant_message: reply }) });
      await waitFor(() => {
        const node = connected.rail.nodes.find(node => node.id === child.id);
        expect(node?.status?.kind).toBe("idle");
        expect(node?.final_text?.kind).toBe(reply === undefined ? "unknown" : reply === "" ? "empty" : "present");
      });
      const node = connected.rail.nodes.find(node => node.id === child.id)!;
      setNow(node.status!.since + 300_000);
      await waitFor(() => expect(rowNames().includes("Child")).toBe(reply !== ""));
    }

    expect(await typed()).toEqual(before);
    expect(calls.slice(callStart).filter(method => method === "terminal.write" || method === "message.send")).toEqual([]);
    expect(questions).toEqual([]);
    expect(await app.rpc("message.list", { to: null, status: null })).toEqual([]);
    await app.rpc("agent.stop", { id: child.id });
  } finally {
    cleanup();
    await real.stop();
    await rm(vendor, { recursive: true, force: true });
  }
}, 120_000);
