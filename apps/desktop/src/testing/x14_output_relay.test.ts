import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer as unixServer } from "node:net";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createServer } from "vite";
import { expect, it } from "vitest";
import { chromePath } from "./chromePage";
import { realDaemon } from "./realDaemonPlugin";

const execute = promisify(execFile);
const bound = <T>(promise: Promise<T>) => Promise.race([promise, new Promise<never>((_, reject) => {
  const timer = setTimeout(() => reject(new Error("fixture barrier exceeded 10 s")), 10_000);
  timer.unref();
  void promise.finally(() => clearTimeout(timer)).catch(() => {});
})]);

const output = (id: string, bytes: number[] | Buffer, offset = 0) => JSON.stringify({ jsonrpc: "2.0", method: "event", params: {
  actor: { kind: "user", id: "you", parent: null }, name: "terminal.output", data: { id, data: Buffer.from(bytes).toString("base64"), offset },
} }) + "\n";

const fixture = async () => {
  const dir = await mkdtemp(join(tmpdir(), "x14-relay-"));
  const path = join(dir, "daemon.sock");
  const sockets = new Set<Socket>();
  const subscriptions: Socket[] = [];
  const responses: ServerResponse[] = [];
  const server = unixServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    let pending = "";
    socket.on("data", (chunk) => {
      pending += chunk.toString();
      const end = pending.indexOf("\n");
      if (end < 0) return;
      const frame = JSON.parse(pending.slice(0, end));
      pending = pending.slice(end + 1);
      if (frame.method === "events.subscribe") subscriptions.push(socket);
      socket.write(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: frame.method === "events.subscribe" ? null : "control-reply" }) + "\n");
    });
  });
  server.listen(path);
  await once(server, "listening");
  const vite = await createServer({ configFile: false, root: dir, logLevel: "silent", server: { host: "127.0.0.1", port: 0 }, plugins: [{
    name: "fixture-response-observer",
    configureServer(dev) {
      dev.middlewares.use((req, res, next) => {
        if (req.url?.startsWith("/__daemon/output?")) responses.push(res);
        if (req.url === "/") { res.setHeader("Content-Type", "text/html"); res.end("<!doctype html><title>X14 transport</title>"); }
        else next();
      });
    },
  }, realDaemon({ project: dir, socket: path, proof: "0".repeat(64) })] });
  await vite.listen();
  const base = vite.resolvedUrls!.local[0]!.replace(/\/$/, "");
  const clients: IncomingMessage[] = [];
  const select = async (id: string) => {
    const count = subscriptions.length;
    const response = await bound(new Promise<IncomingMessage>((resolve, reject) => {
      request(`${base}/__daemon/output?terminal=${id}&after=0`, (res) => { res.on("error", () => {}); clients.push(res); resolve(res); }).on("error", reject).end();
    }));
    expect(response.statusCode).toBe(200);
    await expect.poll(() => subscriptions.length).toBe(count + 1);
    return { response, socket: subscriptions[count]! };
  };
  return { dir, base, subscriptions, responses, select, close: async () => {
    for (const client of clients) client.destroy();
    for (const socket of sockets) socket.destroy();
    await vite.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  } };
};

it("x14_harness_output_relay_selects_exact_bytes", async () => {
  const real = await fixture();
  const executable = chromePath();
  const profile = join(real.dir, "profile");
  const config = join(real.dir, "browser.json");
  await writeFile(config, "{}");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_")));
  const browser = async (...args: string[]) => {
    if (!executable) throw new Error("X14 requires isolated Chromium: set CHROME_PATH");
    const { stdout } = await execute("agent-browser", ["--executable-path", executable, "--args", "--no-sandbox", "--config", config, "--session", `x14-${process.pid}`, "--profile", profile, "--json", ...args], { env, timeout: 30_000 });
    const reply = JSON.parse(stdout);
    expect(reply.success, stdout).toBe(true);
    return reply.data;
  };
  try {
    await browser("open", real.base);
    await browser("eval", `window.received = {}; window.meta = {}; window.start = (id) => {
      window.received[id] = []; fetch('/__daemon/output?terminal=' + id + '&after=0').then(async response => {
        window.meta[id] = [response.status, response.headers.get('content-type'), response.headers.get('x-terminal'), response.headers.get('x-output-after')];
        const reader = response.body.getReader();
        for (;;) { const { value, done } = await reader.read(); if (done) break; window.received[id].push(...value); }
      });
    }; window.start('A');`);
    await expect.poll(() => real.subscriptions.length).toBe(1);
    await browser("eval", "window.start('B')");
    await expect.poll(() => real.subscriptions.length).toBe(2);
    for (const socket of real.subscriptions) {
      // Both selections see the same current Event envelopes; only selected bytes may cross HTTP.
      socket.write(output("A", [0, 27, 255, 226], 0));
      socket.write(output("B", [66, 0], 0));
      socket.end(output("A", [130, 172, 128], 4));
    }
    await browser("wait", "--fn", "window.received.A.length === 7 && window.received.B.length === 2");
    expect((await browser("eval", "window.received")).result).toEqual({ A: [0, 27, 255, 226, 130, 172, 128], B: [66, 0] });
    expect((await browser("eval", "window.meta")).result).toEqual({ A: [200, "application/octet-stream", "A", "0"], B: [200, "application/octet-stream", "B", "0"] });
  } finally {
    try { await browser("close"); } finally { await real.close(); }
  }
}, 90_000);
