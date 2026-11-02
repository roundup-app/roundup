// @vitest-environment jsdom
import { waitFor } from "@solidjs/testing-library";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromePath, openPage, type ChromePage } from "../testing/chromePage";
import { expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { withProject } from "../testing/realDaemonFixture";
import { createServedApp } from "../testing/realSeam";

it("u5531c_door_tool_internal_child_returns_when_it_needs_you", async () => {
  const triggerDir = await mkdtemp(join(tmpdir(), "u5531-native-"));
  const trigger = join(triggerDir, "request");
  const rup = resolve("../../target/debug/rup");

  const native = `import os, pathlib, subprocess, sys, time, json
while not pathlib.Path(sys.argv[1]).exists(): time.sleep(0.01)
subprocess.run([sys.argv[2], 'signal', os.environ['ROUNDUP_AGENT_ID']], input=json.dumps(dict(hook_event_name='PermissionRequest',tool_name='Bash',tool_input=dict(command='true'))),text=True,check=True,env={**os.environ,'ROUNDUP_ATTEMPT':'1'})
`;

  try {
    await withProject(async real => {
      const app = createServedApp(real.base);
      let page: ChromePage | undefined;

      try {
        const door = await app.rpc("rail.createWorkstream", { name: "Observer", parent: null });
        await app.rpc("rail.startDoor", { id: door.id });
        const child = await app.rpc("agent.spawn", { cwd: real.dir, parent: door.id, prompt: null, name: "Helper" });
        await app.rpc("agent.signal", { id: child.id, attempt: child.attempt!, payload: { hook_event_name: "UserPromptSubmit", prompt_id: "turn" } });

        // Exercise the same stdio tool a Door calls, against this fixture's real Daemon.
        const script = `import json, subprocess, sys
p = subprocess.Popen([sys.argv[1], 'mcp', sys.argv[2]], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
def request(i, method, params):
 p.stdin.write(json.dumps(dict(jsonrpc='2.0', id=i, method=method, params=params))+'\\n'); p.stdin.flush()
 while True:
  reply=json.loads(p.stdout.readline())
  if reply.get('id')==i: return reply
try:
 request(1, 'initialize', dict(protocolVersion='2025-06-18', capabilities={}, clientInfo=dict(name='observer',version='0')))
 p.stdin.write(json.dumps(dict(jsonrpc='2.0',method='notifications/initialized'))+'\\n'); p.stdin.flush()
 print(json.dumps(request(2, 'tools/call', dict(name='agent_set_visibility', arguments=dict(id=sys.argv[3],visibility='internal')))))
finally:
 p.terminate(); p.wait(timeout=5)
`;

        const { stdout } = await promisify(execFile)("python3", ["-c", script, resolve("../../target/debug/rup"), door.id, child.id], { env: { ...process.env, RUPD_SOCKET: real.socket }, timeout: 20_000 });
        expect(JSON.parse(stdout).result.isError).not.toBe(true);
        const found = chromePath();

        if (!found) throw new Error("U5531 needs isolated headless Chromium");
        page = await openPage(found);
        await page.scheme("dark");
        await page.load(`${real.base}/harness.html?daemon=1&view=workstreams&items=1&tabs=1`);
        const branch = `[data-id="fold:internal:${door.id}"]`;
        const row = `[data-id="${child.id}"]`;
        await page.until(`() => !!document.querySelector('${branch}')`);
        expect(await page.call(`() => document.querySelector('${row}') === null`)).toBe(true);
        await page.call(`() => document.querySelector('${branch} [data-part=branch-control]').click()`);
        await page.until(`() => !!document.querySelector('${row}')`);
        const before = await app.rpc("terminal.screen", { id: child.terminal_id! });
        await writeFile(trigger, "request");
        await waitFor(async () => expect((await app.rpc("rail.tree", null)).find(node => node.id === child.id)).toMatchObject({ visibility: "shown", terminal_id: child.terminal_id, status: { kind: "needs-you" } }));
        await page.until(`() => !document.querySelector('${branch}') && !!document.querySelector('${row}[data-kind=needs-you]')`);
        expect(await page.call(`() => document.querySelector('${row}').closest('[data-id^="fold:"]') === null`)).toBe(true);
        expect(await app.rpc("terminal.screen", { id: child.terminal_id! })).toEqual(before);
      } finally {
        await page?.close();
      }
    }, true, { FAKE_CLAUDE_CHILD_PROCESS: JSON.stringify(["python3", "-c", native, trigger, rup]) });
  } finally {
    await rm(triggerDir, { recursive: true, force: true });
  }
}, 120_000);
