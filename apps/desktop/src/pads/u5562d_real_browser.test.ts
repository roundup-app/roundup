import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect } from "vitest";
import { shelfBrowser } from "../shelf/u371Browser";
import { realBrowserTest } from "../testing/realDaemonFixture";
import { createServedApp } from "../testing/realSeam";
import { captureDir } from "../testing/captures";

const { browser, evaluate } = shelfBrowser();

const source = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'].map(kind => `> [!${kind}]\n> Keep this\n> and this\n`).join('\n') + '\n<span data-pad-color="blue">a *linked* [word](https://example.com)</span>\n\n<mark>highlight</mark> and <mark><span data-pad-color="blue">both</span></mark>\n\n```ts\nconst answer: number = 42; // keeper\n```\n\nSeparate paragraph\n';

realBrowserTest("u5562d_colour_round_trip", { timeout: 240000, retry: 0 }, async ({ real }) => {
  const app = createServedApp(real.base);
  const client = new Client({ name: "Pad round trip", version: "1" });

  try {
    const agent = await app.rpc("agent.spawn", { cwd: real.dir, parent: null, prompt: null, name: "Pad author", order: { kind: "work", ask: "inspect", limits: [] } });
    await client.connect(new StdioClientTransport({ command: resolve("../../target/debug/rup"), args: ["mcp", agent.id], env: { ...process.env, RUPD_SOCKET: real.socket } }));

    const call = async (name: string, args: { name: string; text?: string }) => {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).not.toBe(true);
      const text = result.content;

      if (!Array.isArray(text) || text[0]?.type !== "text") throw new Error("MCP returned no text");

      return JSON.parse(text[0].text);
    };

    await call("pad_create", { name: "Colour round trip" });
    await call("pad_write", { name: "Colour round trip", text: source });
    const before = await call("pad_read", { name: "Colour round trip" });
    expect(before.text).toBe(source);
    await browser("set", "media", "dark");
    await browser("set", "viewport", "1512", "950");
    await browser("open", `${real.base}/harness.html?daemon=1&view=workstreams&items=1&tabs=1`);
    await browser("wait", "#shelf-tab-pads");
    await evaluate(`(() => { const tab = document.querySelector("#shelf-tab-pads"); if (tab.getAttribute("aria-expanded") !== "true") tab.click(); return true; })()`);

    const open = async () => {
      await browser("wait", ".pads-tab [data-shelf-group]");
      await evaluate(`(() => { for (const group of document.querySelectorAll('[data-shelf-group] [data-part=branch-control]')) if (group.closest('[role=treeitem]')?.getAttribute('aria-expanded') === 'false') group.click(); return true; })()`);
      await browser("wait", ".pad-name");
      await evaluate(`(() => { [...document.querySelectorAll('.pad-name')].find(row => row.textContent === 'Colour round trip').focus(); return true; })()`);
      await browser("press", "Enter");
      await browser("wait", ".drawer .pad-syntax-keyword");
    };

    await open();

    for (const id of ["U5562a", "U5562b", "U5562c", "U5562d"]) {
      const dir = captureDir(id);

      if (!dir) continue;
      await mkdir(dir, { recursive: true });
      await browser("screenshot", join(dir, "colour-dark.png"));
      await writeFile(join(dir, "colour-dark.checks.json"), JSON.stringify(await evaluate("window.__checks()")));
      await browser("set", "media", "light");
      await browser("screenshot", join(dir, "colour-light.png"));
      await browser("set", "media", "dark");
    }

    await browser("click", ".drawer .close");
    const unchanged = await call("pad_read", { name: "Colour round trip" });
    expect(unchanged.text).toBe(source);
    expect(unchanged.revision).toBe(before.revision);
    await open();
    await evaluate(`(() => { const field = document.querySelector('.drawer .ProseMirror'); const paragraph = [...field.querySelectorAll('p')].find(p => p.textContent === 'Separate paragraph'); const range = document.createRange(); range.selectNodeContents(paragraph); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); field.focus(); return true; })()`);
    await browser("press", "Backspace");
    await browser("keyboard", "type", "Changed paragraph");
    await browser("click", ".drawer .close");
    const changed = source.replace("Separate paragraph", "Changed paragraph");
    const after = await call("pad_read", { name: "Colour round trip" });
    expect(after.text).toBe(changed);
    expect(after.revision).toBe(before.revision + 1);
    await open();
    expect(await evaluate("document.querySelector('.drawer .ProseMirror').textContent.includes('Changed paragraph')")).toBe(true);
    const path = join(real.dir, "colour.md");
    await app.rpc("pad.export", { name: "Colour round trip", path });
    expect(await readFile(path, "utf8")).toBe(changed);
  } finally {
    await client.close();
    await browser("open", "about:blank");
  }
});
