import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { appServer } from "../testing/appServer";
import { chromePath } from "../testing/chromePage";
import { captureDir } from "../testing/captures";

const execute = promisify(execFile);

it("u3791b_rendered_failure_keeps_explicit_recovery", async () => {
  const profile = await mkdtemp(join(tmpdir(), "u3791b-browser-"));
  const config = join(profile, "config.json");
  await writeFile(config, "{}");
  const executable = chromePath();

  if (!executable) throw new Error("U3791b needs isolated headless Chromium");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_")));
  const session = `u3791b-${process.pid}`;

  const browser = async (...args: string[]) => {
    const { stdout } = await execute("agent-browser", ["--executable-path", executable, "--args", "--no-sandbox", "--config", config, "--session", session, "--profile", profile, "--json", ...args], { env, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    const answer = JSON.parse(stdout);

    if (!answer.success) throw new Error(stdout);

    return answer.data;
  };

  const evaluate = async (source: string) => (await browser("eval", source)).result;
  const wait = (source: string) => browser("wait", "--fn", source);

  const baseline = process.env.ROUNDUP_BASELINE_ROOT;
  const server = await appServer(baseline ? { root: baseline } : {});

  const capture = async (name: string) => {
    const captureRoot = captureDir("U3791b");
    const dir = captureRoot ? join(captureRoot, baseline ? "base" : "head") : null;

    if (!dir) return;
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${name}.checks.json`), JSON.stringify(await evaluate("window.__checks()")));
    await browser("screenshot", join(dir, `${name}.png`));
  };

  try {
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");
    await browser("open", `${server.resolvedUrls.local[0]}harness.html?seed=tree-40`);
    await wait("!!window.__fake && document.querySelectorAll('.rail-row').length > 10");
    await evaluate(`(async () => {
      const app = window.__fake.app;
      const nodes = await app.handlers['rail.tree'](null);
      const node = nodes.find(n => n.kind === 'agent');
      app.handlers['rail.tree'] = () => nodes.map(n => n.id === node.id ? {...n, work:{kind:'work', ask:'Finish the repair', limits:[]}} : n);
      const {progressSeed} = await import('/src/testing/progressSeed.ts');
      const seed = progressSeed({project:app.opened.project.path, agent:node.id});
      app.handlers['agent.spawnPrompt'] = () => ({prompt:'Finish the repair'});
      app.handlers['message.progress'] = () => seed.progress;
      app.handlers['message.reconcileWork'] = () => seed.plan;
      window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed',data:null});
      return node.id;
    })()`).then(async id => { await browser("click", `.rail-row[data-id='${id}']`); });
    await wait("!!document.querySelector('.order-line')");
    await browser("click", ".order-line");
    await wait("!!document.querySelector('.progress-head button')");
    await capture("before");
    await evaluate(`window.__fake.app.handlers['message.resumeWork'] = async () => { const {RpcError} = await import('/src/app/seam.ts'); throw new RpcError(-32002, 'diagnostic remains exactly as supplied'); }`);
    await browser("click", ".progress-head button");
    await wait("document.querySelector('.progress-status')?.title.includes('remains exactly as supplied')");
    expect(await evaluate("window.__fake.app.calls.filter(c => c.method === 'message.resumeWork').length")).toBe(1);
    await capture("refused");
    await evaluate(`window.__fake.app.handlers['message.resumeWork'] = async () => { const {RpcError} = await import('/src/app/seam.ts'); throw new RpcError(-32006, 'refused; choose again'); }`);
    await browser("click", ".progress-head button");
    await wait("document.querySelector('.progress-status')?.title.includes('choose again')");
    expect(await evaluate("window.__fake.app.calls.filter(c => c.method === 'message.resumeWork').length")).toBe(2);
    await capture("unknown");
  } finally {
    await browser("close");
    await rm(profile, { recursive: true, force: true });
    await server.close();
  }
}, 60_000);
