import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copy } from "../importer/copy";
import { openLane } from "../todos/laneBrowser";
import { captureDir } from "../testing/captures";
import { appServer, type AppServer } from "../testing/appServer";

const output = captureDir("U3799") ?? captureDir("U3805") ?? "";

describe.runIf(Boolean(output))("u3799 isolated rendered observer", () => {
  let server: AppServer;
  beforeAll(async () => { server = await appServer(); }, 120_000);
  afterAll(async () => { await server?.close(); });

  it("u3799_u3805_rendered_settings_checks", async () => {
    const { stdout } = await promisify(execFile)("python3", ["src/settings/u3799_browser.test.py", server.resolvedUrls.local[0]!, output], { timeout: 180_000, maxBuffer: 2 * 1024 * 1024 });

    expect(stdout).toContain("ok");
  }, 60_000);
});

it.skipIf(!captureDir("U4277c")).each(["tree-40", "tabs-8"].flatMap(seed =>
  ["ask-history", "made", "resources", "workstreams", "terminal-tabs", "import-work"].map(view => [seed, view] as const),
))("u5608_u4277c_requested_%s_%s_empty_and_filled", async (seed, view) => {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { execFileSync } = await import("node:child_process");
  const phase = process.env.ROUNDUP_CAPTURE_PHASE ?? "head";
  const dir = join(captureDir("U4277c")!, phase, seed);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "commit.txt"), execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }));
  const lane = await openLane(1512, "dark", "u4277c");
  const agent = seed === "tabs-8" ? "p2-agent" : "agent-1";
  const origin = await lane.evaluate<string>("location.origin");

  const capture = async (name: string) => {
    writeFileSync(join(dir, name + ".checks.json"), JSON.stringify(await lane.evaluate("window.__checks()")) + "\n");
    await lane.browser("screenshot", join(dir, name + ".png"));
  };

  const command = async (name: string) => {
    await lane.evaluate(`window.dispatchEvent(new CustomEvent('open-project-page', {detail:{path:window.__auditPath,command:${JSON.stringify(name)}}}))`);
  };

  let recording = false;

  try {
    for (const filled of [false, true]) {
        await lane.evaluate("localStorage.clear()");
        // Recording creates the page; navigate that page directly before installing fixtures.
        const captureSeed = seed === "tabs-8" ? seed : filled || view === "resources" ? seed : "empty-project";

        await lane.browser("record", "start", join(dir, `${view}-${filled ? "filled" : "empty"}.webm`), `${origin}/harness.html?view=workstreams&seed=${captureSeed}`);
        recording = true;

        await lane.until(seed === "tabs-8" ? "!!window.__fake && document.querySelectorAll('.project-tab').length === 8" : "!!window.__fake && !!document.querySelector('.rail-scroll')");
        await lane.browser("set", "viewport", "1512", "950");
        await lane.browser("set", "media", "dark");

        if (seed === "tabs-8") {
          await lane.until("document.querySelectorAll('.project-tab').length === 8");
          await lane.browser("focus", '.project-tab[data-path="/Users/you/project-number-2"] [role=tab]');
          await lane.browser("press", "Enter");
          await lane.until("document.querySelector('.project-tab[data-path=\"/Users/you/project-number-2\"] [role=tab]')?.getAttribute('aria-selected') === 'true' && !!document.querySelector('.ask-bar')");
        }

        await lane.until("!!document.querySelector('.ask-bar')");

        await lane.evaluate(`window.__fake.app.projects().then(projects => {window.__auditPath = projects[${seed === "tabs-8" ? 1 : 0}].path; window.__fake.app = window.__fake.app.of(window.__auditPath); return true;})`);

        if (seed === "tabs-8" && !filled && view !== "resources") {
          await lane.evaluate(`(() => {
            window.__fake.app.handlers['rail.tree'] = () => [];
            window.__fake.app.handlers['terminal.list'] = () => [];
            window.__fake.app.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'});
            window.__fake.app.emit({actor:{kind:'user',id:'you',parent:null},name:'terminal.changed'});
            return true;
          })()`);
          await lane.until("document.querySelectorAll('.rail-row').length === 0 && !document.querySelector('.terminal-tab')");
        }

        if (seed === "tabs-8" && filled && view === "workstreams") {
          await lane.evaluate("window.__fake.app.rpc('rail.createWorkstream', {name:'Distinct long Workstream 長い名前 '.repeat(12),parent:null})");
          await lane.until("[...document.querySelectorAll('.rail-row')].some(row => row.textContent.includes('Distinct long Workstream'))");
        }

        await lane.evaluate(`(() => {
          const app = window.__fake.app;
          app.handlers['ask.list'] = () => [];
          app.handlers['deliverable.list'] = () => [];
          app.handlers['project.resources'] = () => ({agents: ${filled ? "[{id:'" + agent + "',memory_bytes:412000000,cpu_percent:18,disk_bytes:2100000000}]" : "[]"},total:{memory_bytes:0,cpu_percent:0,disk_bytes:0}});
          app.handlers['project.importDiscover'] = () => ({candidates:${filled ? "Array.from({length:3},(_,i)=>({source:'s'+i,revision:'r'+i,title:('Distinct conversation '+i+' 長い名前 ').repeat(12),cwd:'src',last_activity_ms:1n}))" : "[]"},excluded:[]});
          return true;
        })()`);

        if (view === "resources") {
          await command("view:workstreams");
          await lane.browser("focus", `.rail-row[data-id="${agent}"]`);
          await lane.browser("press", "Enter");
          await lane.until(`document.querySelector('.rail-row[data-id="${agent}"]')?.dataset.selected === 'true'`);
          await lane.evaluate(`(async () => {
            const nodes = await window.__fake.app.rpc('rail.tree', null);
            for (const node of nodes) if (node.id === ${JSON.stringify(agent)}) node.status.kind = 'working';
            window.__fake.app.handlers['rail.tree'] = () => nodes;
            window.__fake.app.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'});
            return true;
          })()`);
        }

        if (filled && view === "ask-history") await lane.evaluate(`window.__fake.app.emit({actor:{kind:'user',id:'you',parent:null},name:'ask.changed',data:{ask:{id:'audit',at:'1',text:'Audit',parts:[{text:'Long authored request '.repeat(20),placement:{kind:'routed',workstream:'backend'},state:'typed'}]}}})`);

        if (filled && view === "made") await lane.evaluate(`(() => {
          window.__fake.app.handlers['deliverable.list'] = () => [{id:'publication-a',project:window.__auditPath,maker:{kind:'agent',id:'agent-1',parent:null},maker_name:'Retained maker',home:null,title:'Published result 長い名前 '.repeat(20),published_at:1,target:{kind:'external',url:'https://example.com/exact-target',availability:'unchecked'}}];
          window.__fake.app.emit({actor:{kind:'user',id:'you',parent:null},name:'deliverable.changed'}); return true;
        })()`);
        await lane.resetCalls();

        // U4274b/c: Rail and Terminal navigation are primary; their visibility commands were retired.
        if (view === "ask-history") {
          // The Overview list is the centre view; nothing to open.
        } else if (view !== "workstreams" && view !== "terminal-tabs") await command(view === "import-work" ? view : `view:${view}`);
        const selector = {"ask-history":".changes",made:".ask-bar",resources:".resource-inspection",workstreams:".rail","terminal-tabs":".terminal-tabs","import-work":".import-panel"}[view];
        await lane.until(view === "terminal-tabs" && !filled ? "!document.querySelector('.terminal-tab')" : `!!document.querySelector('${selector}')`);
        expect((await lane.calls()).filter(call => ["agent.spawn", "rail.startDoor", "ask.send", "terminal.write", "project.importCommit"].includes(call.method))).toEqual([]);

        if (view === "ask-history") await lane.until(filled ? "!!document.querySelector('.ask-row')" : "!!document.querySelector('.changes .overview-quiet')");

        if (view === "made") await lane.until("document.querySelector('.made')?.getAttribute('aria-busy') === 'false'");

        if (filled && view === "made") await lane.until("!!document.querySelector('.made-row')");

        if (view === "resources") await lane.until(`document.querySelector('.resource-inspection')?.getAttribute('aria-busy') === 'false' && window.__fake.app.calls.some(call => call.method === 'project.resources')${filled ? " && document.querySelectorAll('.resource-value').length === 3" : ""}`);

        if (filled && view === "import-work") {
          await lane.until("document.querySelectorAll('.import-check').length === 3");
          await lane.browser("click", ".import-check");
          await lane.browser("click", ".import-candidate:nth-child(2) .import-check");
          await capture(`${view}-selected`);
          await lane.evaluate(`(() => {window.__fake.app.handlers['project.importCommit'] = () => ({outcomes:[{source:'s0',workstream:'imported',agent:'imported-agent',error:null},{source:'s1',workstream:null,agent:null,error:{code:-32003,message:'Storage is unavailable. Free disk space, refresh the conversation list, then retry the selected conversation. '+ 'Complete recovery details '.repeat(15),outcome:'failed'}}]});return true;})()`);
          await lane.browser("click", ".import-confirm");
          const refusal = copy.importRowRefusal({code: -32003, outcome: "failed"});

          if (!refusal) throw new Error("The failed Import source has no recovery guidance");
          await lane.until(`document.querySelector('.import-candidate:nth-child(2) .reserved-line:not([data-empty])')?.textContent.includes(${JSON.stringify(refusal)})`);
        }

        await capture(`${view}-${filled ? "filled" : "empty"}`);
        await lane.browser("record", "stop");
        recording = false;
    }
  } finally {
    try { if (recording) await lane.browser("record", "stop"); } finally { await lane.close(); }
  }
}, 60_000);
