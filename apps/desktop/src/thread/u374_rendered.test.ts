import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createServer } from "vite";
import { expect, it } from "vitest";
import { captureDir } from "../testing/captures";

const execute = promisify(execFile);

/** An isolated headless agent-browser observes the U374 prompt on the densest harness. */
it("u374_rendered_plan_choice_pending_and_result", async () => {
  const profile = mkdtempSync(join(tmpdir(), "roundup-u374-"));
  const name = `u374-${process.pid}`;
  const server = await createServer({ server: { host: "127.0.0.1", port: 0, strictPort: false } });
  const run = async (...args: string[]) => (await execute("agent-browser", ["--session", name, ...args], { timeout: 30_000 })).stdout.trim();
  const evaluate = async (source: string) => JSON.parse(await run("eval", source));
  const directory = captureDir("U374");

  try {
    await server.listen();
    const url = server.resolvedUrls!.local[0]!;

    await run("--profile", profile, "open", `${url}harness.html?seed=tree-40`);

    for (const width of [1280, 1440]) for (const scheme of ["light", "dark"]) {
      await run("set", "media", scheme);
      await run("set", "viewport", String(width), "800");
      await run("open", `${url}harness.html?seed=tree-40`);
      await run("wait", "[role=treeitem]");
      await evaluate(`(async () => {
        const f = window.__fake;
        const nodes = await f.app.rpc('rail.tree', {});
        const door = nodes.find(n => n.kind === 'workstream' && n.name.startsWith('payments'));
        window.__rewindDoor = door.id;
        f.app.handlers['checkpoint.list'] = () => [];
        f.app.handlers['workstream.rewindPlan'] = () => ({agents: [{agent: door.id, name: door.name, takeover: false, created_after: false, files_changed: []}, {agent: 'agent-1', name: 'Longest Agent name ' + 'long '.repeat(15), takeover: true, created_after: false, files_changed: []}], files_changed: false});
        f.app.handlers['workstream.rewind'] = () => new Promise(resolve => window.__rewindFinish = resolve);
        document.querySelector('[role=treeitem][data-id="' + door.id + '"]').click();
        f.emit({actor: {kind: 'user', id: 'you', parent: null}, name: 'checkpoint.written', data: {id: 1, workstream: door.id, at: Date.now(), title: 'Working files reviewed', blocks: [{kind: "rows", title: "Decided", rows: [{label: "Files", value: "Reviewed"}]}, {kind: "text", title: "Next", text: "Continue the work"}], rewindable: true}});
        document.querySelector('[aria-label=More]').click();
        Array.from(document.querySelectorAll('[role=menuitem]')).find(e => e.textContent === 'All messages').click();
        return true;
      })()`);
      await run("wait", "[data-checkpoint]");
      const before = await evaluate("document.querySelector('[data-log]').getBoundingClientRect().height");

      await evaluate("document.querySelector('.thread-checkpoint-rewind').click(); true");
      await run("wait", "[data-rewind-agent]");
      expect(await evaluate("document.querySelector('[data-log]').getBoundingClientRect().height")).toBe(before);

      const capture = async (state: string) => {
        const checks = await evaluate("window.__checks()");
        const fits = await evaluate("(() => { const prompt = document.querySelector('[data-rewind-prompt]'); const shelf = document.querySelector('.shelf'); return !prompt || prompt.getBoundingClientRect().right <= shelf.getBoundingClientRect().left; })()");

        if (state !== "result") {
          expect(await evaluate(`(() => {
            const prompt = document.querySelector('[data-rewind-prompt]');
            const feed = document.querySelector('.thread-feed').getBoundingClientRect();
            const box = prompt.getBoundingClientRect();
            return box.top >= feed.top && box.bottom <= feed.bottom &&
              [...prompt.querySelectorAll('button, input')].every(control => {
                const rect = control.getBoundingClientRect();
                return prompt.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
              });
          })()`), `${state}: controls visible together`).toBe(true);
          expect(await evaluate(`(() => {
            const row = document.querySelector('[data-rewind-agent]');
            const name = row.querySelector('.thread-rewind-name').getBoundingClientRect();
            const state = row.querySelector('.thread-rewind-state').getBoundingClientRect();
            return Math.abs((name.top + name.bottom) / 2 - (state.top + state.bottom) / 2) < 1;
          })()`)).toBe(true);
        }

        if (state === "files") {
          expect(await evaluate(`(() => {
            const list = document.querySelector('.thread-rewind-paths');
            return list.scrollHeight === list.clientHeight && list.children.length === 6 &&
              [...list.querySelectorAll('[title]')].every(path => path.title === path.textContent && getComputedStyle(path).whiteSpace === 'nowrap');
          })()`)).toBe(true);
        }

        expect(fits, `${state}: prompt covered by Shelf`).toBe(true);

        for (const id of ["D1", "D2", "D5", "D6", "D8"]) expect(checks[id].status, `${state} ${width}: ${id}`).toBe("pass");

        if (directory !== null) {
          mkdirSync(directory, { recursive: true });
          writeFileSync(join(directory, `${state}-${scheme}-${width}x800.checks.json`), JSON.stringify(checks, null, 2) + "\n");
          await run("screenshot", join(directory, `${state}-${scheme}-${width}x800.png`));
        }
      };

      await capture("plan");
      await evaluate(`window.__fake.app.handlers['workstream.rewindPlan'] = () => ({agents: [{agent: window.__rewindDoor, name: 'Longest Agent name ' + 'long '.repeat(15), takeover: false, created_after: false, files_changed: ['.github/workflows/build.yml', '.agents/data/harness.md', '_private/file.ts', ...Array.from({length: 4}, (_, i) => 'src/long-directory/' + 'path-'.repeat(12) + i + '.tsx')]}], files_changed: true}); document.querySelector('[data-rewind-prompt] button:last-child').click(); document.querySelector('.thread-checkpoint-rewind').click(); true`);
      await run("wait", "[type=radio]");
      expect(await evaluate("document.querySelector('[data-rewind-prompt] [data-button=primary]').getAttribute('aria-disabled') === 'true'")).toBe(true);
      expect(await evaluate(`(() => {
        return [...document.querySelectorAll('.thread-rewind-paths [title]')].slice(0, 3).every(path => {
          const text = path.querySelector('bdi').firstChild;
          const first = document.createRange();
          first.setStart(text, 0); first.setEnd(text, 1);
          const second = document.createRange();
          second.setStart(text, 1); second.setEnd(text, 2);
          return first.getBoundingClientRect().left < second.getBoundingClientRect().left;
        });
      })()`), "leading dot and underscore stay before the path").toBe(true);
      await capture("files");
      await evaluate("document.querySelector('[type=radio]').click(); document.querySelector('[data-rewind-prompt] [data-button=primary]').click(); true");
      await capture("pending");
      await evaluate(`window.__rewindFinish({rewound: [window.__rewindDoor], removed: [], skipped: []}); window.__fake.emit({actor: {kind: 'user', id: 'you', parent: null}, name: 'workstream.rewound', data: {id: window.__rewindDoor, checkpoint: 1}}); true`);
      await run("wait", "[data-rewound]");
      await capture("result");
      await evaluate(`window.__fake.app.handlers['workstream.rewind'] = () => Promise.reject(new Error('Worktree could not restart')); document.querySelector('.thread-checkpoint-rewind').click(); true`);
      await run("wait", "[type=radio]");
      await evaluate("document.querySelector('[type=radio]').click(); document.querySelector('[data-rewind-prompt] [data-button=primary]').click(); true");
      await run("wait", "[data-rewind-prompt] [role=alert]");
      expect(await evaluate("document.querySelector('[data-rewind-prompt] [role=alert]').textContent")).toContain("Worktree could not restart");
      expect(await evaluate("(() => {const box = document.querySelector('[data-rewind-prompt] [role=alert]').getBoundingClientRect(); const feed = document.querySelector('.thread-feed').getBoundingClientRect(); return box.top >= feed.top && box.bottom <= feed.bottom;})()")).toBe(true);
      await capture("failure");
    }
  } finally {
    await run("close");
    await server.close();
    rmSync(profile, { recursive: true, force: true });
  }
}, 180_000);
