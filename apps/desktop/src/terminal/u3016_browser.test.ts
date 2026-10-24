import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, appendFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { startRealDaemon } from "../testing/realDaemonFixture";
import { createServedApp } from "../testing/realSeam";
import { chromePath } from "../testing/chromePage";
import { captureDir } from "../testing/captures";
import { appServer } from "../testing/appServer";
import type { RpcMethods } from "@contracts/methods";
import { measurementFixture } from "../testing/measurementFixture";

const exec = promisify(execFile);

it("u3016f_real_collection_to_dashboard_survives_reopen", async () => {
  const profile = mkdtempSync(join(tmpdir(), "u3016-profile-"));
  writeFileSync(join(profile, "config.json"), "{}");
  // Reuse the real Daemon collector observer's isolated vendor, including native hooks
  // and authenticated calls. This is fixture data, not a second source interpreter.
  const sourceFixture = readFileSync(resolve("../../crates/rupd/tests/workstream_measurement.rs"), "utf8").split('const FAKE: &str = r#"')[1]!.split('"#;')[0]!;
  const inboxSource = readFileSync(resolve("../../crates/rup/tests/e2e/fake_claude.py"),"utf8");
  const listen = "def listen():"+inboxSource.split("def listen():")[1]!.split("def watch_inbox(")[0]!;
  const fixture = sourceFixture.replace("settings = json.load", "def flag(name): return sys.argv[sys.argv.index(name)+1]\n"+listen+"\ninbox=listen()\nsettings = json.load");
  const fake = join(profile, "vendor");
  writeFileSync(fake, fixture, { mode: 0o755 });
  const real = await startRealDaemon({ ROUNDUP_CLAUDE_BIN: fake }, true);
  const session = `u3016-${process.pid}`;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_")));
  const browser = async (...args: string[]) => (await exec("agent-browser", ["--executable-path", chromePath()!, "--args", "--no-sandbox", "--config", join(profile, "config.json"), "--session", session, "--profile", profile, ...args], { env, timeout: 60_000 })).stdout;
  // SAFETY: agent-browser serialises the page expression's JSON value.
  const evaluate = async <T,>(source: string): Promise<T> => JSON.parse(await browser("eval", source)) as T;
  const until = (source: string) => browser("wait", "--fn", source);

  const capture = async (step: string, id = "U3016f") => {
    const dir = captureDir(id);

    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${step}.checks.json`), JSON.stringify(await evaluate("window.__checks()")) + "\n");
    await browser("screenshot", join(dir, `${step}.png`));
  };

  const app = createServedApp(real.base);

  try {
    const home = await app.rpc("rail.createWorkstream", { name: "Measured work", parent: null });
    const other = await app.rpc("rail.createWorkstream", { name: "Other work", parent: null });
    await app.rpc("rail.startDoor", { id: home.id });
    const encoded = real.dir.replace(/[^a-zA-Z0-9]/g, "-");
    const source = `00000000-0000-4000-8000-${home.id.padStart(12, "0")}`;
    const folder = join(real.dir, "claude-config/projects", encoded);
    mkdirSync(folder, { recursive: true });
    const file = join(folder, `${source}.jsonl`);
    writeFileSync(file, "");
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");
    await browser("open", `${real.base}/harness.html?daemon=1&renderer=dom`);
    await until(`!!document.querySelector('.rail [data-id="${home.id}"] [data-part="branch-control"]')`);
    await browser("click", `.rail [data-id="${home.id}"] [data-part="branch-control"]`);
    await until("!!document.querySelector('.measurement-action button')");
    await capture("before");
    await browser("focus", ".measurement-action button");
    await browser("press", "Enter");
    await until("document.querySelector('.measurement-dashboard')?.getAttribute('aria-busy') === 'false'");
    await capture("empty");
    const record = { type: "assistant", sessionId: source, requestId: "request-fixture", message: { model: "claude-sonnet-5-5" } };
    appendFileSync(file, JSON.stringify(record) + "\n");
    await capture("overview");
    const nodes = await app.rpc("rail.tree", null);
    const terminal = nodes.find((node) => node.id === home.id)!.terminal_id!;
    // U3016c excludes idle even when source spans overlap it. The fixture's Ctrl-B
    // sends its real UserPromptSubmit hook before recording working intervals.
    await app.rpc("terminal.write", { id: terminal, data: "Ag==" });
    await until(`document.querySelector('.rail-row[data-id="${home.id}"]')?.dataset.kind === 'working'`);
    // Feed completed evidence through the Attempt's actual capability-bearing trace collector.
    const endpoint = readFileSync(join(real.dir, `endpoint-${home.id}`), "utf8");
    const now = BigInt(Date.now()) * 1_000_000n;
    const span = (name: string, id: string, shift: bigint) => ({ name, traceId: "trace-fixture", spanId: id, startTimeUnixNano: (now - shift - 10_000_000n).toString(), endTimeUnixNano: (now-shift).toString(), attributes: [{ key: "session.id", value: { stringValue: source } }] });
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: [span("claude_code.llm_request", "model-fixture",20_000_000n), span("claude_code.tool.execution", "tool-fixture",0n)] }] }] }) });
    expect(response.status).toBe(200);
    await until("document.querySelector('.measurement-dashboard')?.getAttribute('aria-busy') === 'false'");
    await until("!!document.querySelector('.measurement-rows') && document.querySelector('.measurement-rows').offsetHeight > 0");
    await capture("details");

    const trigger = async <M extends "agent.ask" | "message.send">(method: M, params: RpcMethods[M]["params"]) => {
      writeFileSync(join(real.dir, `call-${home.id}.json`), JSON.stringify({method,params}));
      await app.rpc("terminal.write", {id:terminal,data:"AQ=="});
    };

    await trigger("agent.ask", {question:"Continue measured work?",answers:[{label:"Yes",description:"Continue"}]});
    await until("!!document.querySelector('.decision-card')");
    await browser("press", "Escape");
    await until("document.querySelector('.decision-card')?.offsetHeight > 0");
    await browser("click", '.decision-card [role="option"]');
    await until("document.querySelector('.decision-card button[type=submit]')?.getAttribute('aria-disabled') !== 'true'");
    await browser("click", '.decision-card button[type=submit]');
    await until("!document.querySelector('.decision-card')");
    const receiver=await app.rpc("agent.spawn",{cwd:real.dir,parent:home.id,prompt:null,model:null,effort:null});
    await until(`document.querySelector('.rail-row[data-id="${receiver.id}"]')?.dataset.kind === 'idle'`);
    writeFileSync(join(folder,`00000000-0000-4000-8000-${receiver.id.padStart(12,"0")}.jsonl`), "");
    await trigger("message.send",{to:receiver.id,kind:"note",body:"Measured coordination",replyTo:null});
    await expect.poll(async () => {
      const facts=await app.rpc("project.measurements",null);

      return facts.time_evidence.some((fact) => fact.value.kind === "observed" && fact.value.activity.kind === "coordination");
    }).toBe(true);
    await expect.poll(async () => {
      const facts=await app.rpc("project.measurements",null);

      return facts.time_evidence.some((fact) => fact.value.kind === "observed" && fact.value.activity.kind === "coordination" && fact.value.state.kind === "ended");
    }).toBe(true);
    await browser("click", ".measurement-action button");
    await until("document.querySelector('.measurement-dashboard')?.getAttribute('aria-busy') === 'false'");
    const timed=await app.rpc("project.measurementSummary",{home:home.id,offset:0,revision:null});
    expect(BigInt(timed.time.human_ns)).toBeGreaterThan(0n);
    expect(BigInt(timed.time.coordination_ns)).toBeGreaterThan(0n);
    expect(BigInt(timed.time.execution_ns)).toBeGreaterThan(0n);
    expect(BigInt(timed.time.tools_ns)).toBeGreaterThan(0n);
    await capture("measured-waits");
    // A real source failure keeps the displayed successful subtotal and offers retry.
    renameSync(file, `${file}.held`);
    await until("document.querySelector('.measurement-state')?.dataset.state === 'stale'");
    expect(await evaluate("!!document.querySelector('.measurement-dashboard .measurement-rows')")).toBe(true);
    await capture("stale");
    renameSync(`${file}.held`, file);
    await until("document.querySelector('.measurement-state')?.dataset.state !== 'stale'");
    await capture("retry");
    await app.rpc("agent.stop", { id: home.id });
    await real.restart();
    await browser("open", `${real.base}/harness.html?daemon=1&renderer=dom`);
    await until(`!!document.querySelector('.rail [data-id="${home.id}"] [data-part="branch-control"]')`);
    await browser("click", `.rail [data-id="${home.id}"] [data-part="branch-control"]`);
    await until("!!document.querySelector('.measurement-action button')");
    await browser("click", ".measurement-action button");
    await until("!!document.querySelector('.measurement-dashboard .measurement-rows')");
    expect((await app.rpc("project.measurementSummary", { home: other.id, offset: 0, revision: null })).contributors).toBe(0);
    await capture("reopened");
    await browser("press", "Escape");
    await until("document.activeElement === document.querySelector('.measurement-action button')");
    await capture("keyboard-focus");
    // The dense rendered observer uses the same App and public read contract; arithmetic,
    // stored pagination and production collection are proved by their smaller observers.
    const server = await appServer();
    await browser("open", `${server.resolvedUrls.local[0]}harness.html?seed=tree-40`);
    await until("!!window.__fake");
    const dense = measurementFixture("backend");
    dense.rows.forEach((row, i) => {
      row.maker = `${i} · 成果📖 résumé ${"long contributor name ".repeat(5)}`;

      const spent = BigInt(i + 1) * 1_000_000_000n;
      row.time = { ...row.time, summed_ns: (spent * 4n).toString(), human_ns: spent.toString(), tools_ns: spent.toString(), execution_ns: (spent * 2n).toString(), coverage: i === 19 ? ["Attempt end unknown"] : [] };
    });

    dense.cause = "Fixture collection unavailable; last good measurements remain visible.";
    await evaluate(`window.__fake.app.handlers['project.measurementSummary'] = (params) => ({ ...${JSON.stringify(dense)}, home: params.home }); true`);
    await browser("click", '.rail [data-id="backend"] [data-part="branch-control"]');
    await until("!!document.querySelector('.measurement-action button')");
    await browser("click", ".measurement-action button");
    await until("document.querySelector('.measurement-dashboard')?.getAttribute('aria-busy') === 'false'");
    await until("document.querySelector('.measurement-rows')?.offsetHeight > 0");
    await capture("dense-1005");
    await capture("dense-1005", "U3016g");

    if (captureDir("U3016g")) {
      const show = async (value: typeof dense, step: string) => {
        value.revision = String(BigInt(value.revision) + 1n);
        await evaluate(`window.__fake.app.handlers['project.measurementSummary'] = () => (${JSON.stringify(value)}); window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'project.measurementsChanged',data:{revision:'${value.revision}'}}); true`);
        await until(`document.querySelector('.measurement-dashboard')?.dataset.revision === '${value.revision}' && document.querySelector('.measurement-dashboard')?.getAttribute('aria-busy') === 'false'`);
        await capture(step, "U3016g");
      };

      const owner = measurementFixture("backend");
      owner.revision = dense.revision;
      owner.rows = owner.rows.slice(0, 1); owner.rows[0]!.maker = "Review changes";
      owner.contributors = 1; owner.next_offset = null;
      owner.time = { ...owner.time, elapsed_ns: "624000000000", summed_ns: "556000000000", execution_ns: "1000000000", tools_ns: "0", human_ns: "1000000000", coordination_ns: "0", other_ns: "554000000000", unmeasured_ns: "0" };
      owner.rows[0]!.time = { ...owner.time };
      await show(owner, "owner-other-9m14s");
      owner.time.other_ns = "624000000000"; owner.time.summed_ns = "626000000000"; owner.rows[0]!.time = { ...owner.time };
      await show(owner, "duration-10m24s");

      owner.time = { ...owner.time, summed_ns: "0", execution_ns: "0", tools_ns: "0", human_ns: "0", coordination_ns: "0", other_ns: "0", unmeasured_ns: "0" };
      owner.rows[0]!.time = { ...owner.time, coverage: ["Attempt end unknown"] };
      await show(owner, "unknown-time-one-agent");
      await browser("press", "Tab");
      await browser("focus", ".measurement-row .measurement-mark");
      await until("!!document.querySelector('[role=tooltip]')?.offsetHeight");
      await capture("partial-time-note", "U3016g");
      await browser("focus", ".measurement-dashboard");
      await until("!document.querySelector('[role=tooltip]')");
      owner.rows = []; owner.contributors = 0; owner.time.elapsed_ns = "0";
      await show(owner, "no-work");
    }
  } finally {
    await browser("close").catch(() => undefined);
    await real.stop();
    rmSync(profile, { recursive: true, force: true });
  }
}, 120_000);
