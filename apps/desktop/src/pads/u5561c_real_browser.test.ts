import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { browser, read, wait } from "../ui/tabsBrowser";
import { withProject } from "../testing/realDaemonFixture";
import { createServedApp } from "../testing/realSeam";
import { captureDir } from "../testing/captures";

const execute = promisify(execFile);

const source = "Ready to review.\n\n<details>\n<summary>For Agents</summary>\n\nPath: `日本語/café`\nCommand: `rup pad read notes`\nId: `fixture-5561`\n\n~~~text\nraw evidence: check passed\n~~~\n\n</details>";

it("u5561c_public_pad_round_trip", { retry: 0, timeout: 240_000 }, async () => {
  await withProject(async real => {
  const app = createServedApp(real.base);
  const binary = resolve("../../target/debug/rup");
  const env = { ...process.env, RUPD_SOCKET: real.socket };

  try {
    const home = await app.rpc("rail.createWorkstream", { name: "Review", parent: null });
    const maker = await app.rpc("agent.spawn", { cwd: real.dir, parent: home.id, prompt: null, name: "Writer" });

    // Exercise the public stdio transport with Python's standard JSON/subprocess support.
    const script = `import sys,json,subprocess
p=subprocess.Popen([sys.argv[1],'mcp',sys.argv[2]],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
def send(value):
 p.stdin.write(json.dumps(dict(jsonrpc='2.0',**value))+'\\n');p.stdin.flush()
def call(id,method,params):
 send(dict(id=id,method=method,params=params))
 reply=json.loads(p.stdout.readline());assert 'error' not in reply,reply
 return reply['result']
try:
 call(1,'initialize',dict(protocolVersion='2025-06-18',capabilities={},clientInfo=dict(name='pad-observer',version='1')))
 send(dict(method='notifications/initialized'))
 for id,name,args in [(2,'pad_create',dict(name='notes',text='initial')),(3,'pad_write',dict(name='notes',text=sys.argv[3])),(4,'pad_read',dict(name='notes'))]:
  reply=call(id,'tools/call',dict(name=name,arguments=args));assert not reply.get('isError'),reply
 print(reply['content'][0]['text'])
finally:
 p.stdin.close();p.wait(timeout=5)
`;

    const mcp = await execute("python3", ["-c", script, binary, maker.id, source], { env, timeout: 30_000 });
    expect(JSON.parse(mcp.stdout).text).toBe(source);
    const pad = await app.rpc("pad.read", { name: "notes" });
    expect(pad.home).toBe(home.id);
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");
    await browser("open", `${real.base}/harness.html?view=workstreams&items=1&tabs=1&daemon=1`);
    await wait("!!document.querySelector('#shelf-tab-pads')");
    await browser("click", "#shelf-tab-pads");
    await wait("!!document.querySelector('.pads-tab [data-part=branch-control]')");

    const openPad = async () => {
      if (!await read("!!document.querySelector('.pad-name')")) await browser("click", ".pads-tab [data-part=branch-control]");
      await wait("!!document.querySelector('.pad-name')");
      await browser("focus", ".pad-name");
      await browser("press", "Enter");
      await wait("!!document.querySelector('details[data-pad-agents]')");
    };

    await openPad();

    for (const action of ["click", "Return"]) {
      expect(await read("document.querySelector('details[data-pad-agents]').open")).toBe(false);

      if (action === "Return") await browser("focus", "details[data-pad-agents] summary");

      for (const open of [true, false]) {
        if (action === "click") await browser("click", "details[data-pad-agents] summary");
        else await browser("press", "Enter");
        await wait(`document.querySelector('details[data-pad-agents]').open === ${open}`);
      }
    }

    await browser("click", ".drawer .close");
    await wait("!document.querySelector('.drawer .ProseMirror')");
    expect((await app.rpc("pad.read", { name: "notes" })).text).toBe(source);
    await openPad();
    expect(await read("document.querySelector('details[data-pad-agents]').open")).toBe(false);
    await browser("focus", ".ProseMirror");
    await browser("press", "Control+Home");
    await browser("press", "Shift+End");
    await browser("keyboard", "type", "Updated.");
    await browser("click", ".drawer .close");
    await wait("!document.querySelector('.drawer .ProseMirror')");
    const expected = source.replace("Ready to review.", "Updated.");
    expect((await app.rpc("pad.read", { name: "notes" })).text).toBe(expected);
    const plain = await execute(binary, ["--agent", maker.id, "pad", "read", "notes"], { env });
    expect(JSON.parse(plain.stdout).text).toBe(expected);
    const json = await execute(binary, ["--agent", maker.id, "--json", "pad", "read", "notes"], { env });
    expect(JSON.parse(json.stdout).text).toBe(expected);
    const path = join(real.dir, "export.md");
    await app.rpc("pad.export", { name: "notes", path });
    expect(await readFile(path, "utf8")).toBe(expected);
    await openPad();
    const dir = captureDir("U5561c");

    if (dir) {
      await mkdir(dir, { recursive: true });
      await browser("screenshot", join(dir, "reopened.png"));
      await writeFile(join(dir, "reopened.checks.json"), JSON.stringify(await read("window.__checks()")));
    }
  } finally {
    await browser("open", "about:blank");
  }
  });
});
