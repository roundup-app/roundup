import { buffer } from "node:stream/consumers";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer as unixServer } from "node:net";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";
import { expect, it, vi } from "vitest";
import type { RpcErrorData } from "@contracts/RpcErrorData";
import { RpcError } from "../app/seam";
import { createServedApp } from "./realSeam";
import { realDaemon } from "./realDaemonPlugin";


const bound = <T>(promise: Promise<T>) => Promise.race([promise, new Promise<never>((_, reject) => {
  const timer = setTimeout(() => reject(new Error("fixture barrier exceeded 10 s")), 10_000);
  timer.unref();
  void promise.finally(() => clearTimeout(timer)).catch(() => {});
})]);

const output = (id: string, bytes: number[] | Buffer, offset = 0) => JSON.stringify({ jsonrpc: "2.0", method: "terminal.output", params: {
  id, data: Buffer.from(bytes).toString("base64"), offset,
} }) + "\n";

const gap = (id: string, from: number, to: number) => JSON.stringify({ jsonrpc: "2.0", method: "terminal.gap", params: { id, from, to } }) + "\n";

const fixture = async (offset = 0, failure?: { code: number; message: string; data: RpcErrorData }) => {
  const dir = await mkdtemp(join(tmpdir(), "x14-relay-"));
  const path = join(dir, "daemon.sock");
  const sockets = new Set<Socket>();
  const subscriptions: Socket[] = [];
  const responses: ServerResponse[] = [];
  const activeResponses = new Set<ServerResponse>();

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

      if (frame.method === "events.subscribe" || frame.method === "terminal.output") subscriptions.push(socket);

      // The Daemon answers a Terminal subscription with the offset of its first byte; an unknown Terminal is NOT_FOUND.
      const answer = failure ? { error: failure } : frame.method === "terminal.output"
        ? frame.params.id === "missing" ? { error: { code: -32001, message: "not found: terminal missing" } } : { result: { offset } }
        : { result: frame.method === "events.subscribe" ? null : "control-reply" };

      socket.write(JSON.stringify({ jsonrpc: "2.0", id: frame.id, ...answer }) + "\n");
    });
  });

  let vite: ViteDevServer | undefined;
  const clients: IncomingMessage[] = [];

  const close = async () => {
    for (const client of clients) client.destroy();

    for (const socket of sockets) socket.destroy();

    for (const response of activeResponses) response.destroy();
    await vite?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  };

  try {
    server.listen(path);
    await once(server, "listening");
    vite = await createServer({ configFile: false, root: dir, logLevel: "silent", server: { host: "127.0.0.1", port: 0 }, plugins: [{
      name: "fixture-response-observer",
      configureServer(dev) {
        dev.middlewares.use((req, res, next) => {
          activeResponses.add(res);
          res.on("close", () => activeResponses.delete(res));

          if (req.url?.startsWith("/__daemon/output?")) responses.push(res);

          if (req.url === "/") { res.setHeader("Content-Type", "text/html"); res.end("<!doctype html><title>X14 transport</title>"); }
          else next();
        });
      },
    }, realDaemon({ project: dir, socket: path })] });
    await vite.listen();
  } catch (error) {
    await close();
    throw error;
  }

  const base = vite.resolvedUrls!.local[0]!.replace(/\/$/, "");

  const select = async (id: string) => {
    const count = subscriptions.length;

    const response = await bound(new Promise<IncomingMessage>((resolve, reject) => {
      request(`${base}/__daemon/output?terminal=${id}`, (res) => { res.on("error", () => {}); clients.push(res); resolve(res); }).on("error", reject).end();
    }));

    expect(response.statusCode).toBe(200);
    await expect.poll(() => subscriptions.length).toBe(count + 1);

    return { response, socket: subscriptions[count]! };
  };

  return { dir, base, subscriptions, responses, select, close };
};

it("u144_it_listens_on_loopback_only_and_refuses_a_foreign_host", async () => {
  const real = await fixture();

  try {
    const url = new URL(`${real.base}/__daemon/open`);
    expect(["127.0.0.1", "localhost"]).toContain(url.hostname);

    const status = (host: string) => bound(new Promise<number>((resolve, reject) => {
      request(url, { headers: { host } }, response => {
        response.resume();
        resolve(response.statusCode!);
      }).on("error", reject).end();
    }));

    expect([await status(`127.0.0.1:${url.port}`), await status("evil.example")]).toEqual([200, 403]);
  } finally { await real.close(); }
});

it("u144_closing_the_socket_fires_daemon_exited", async () => {
  const real = await fixture();
  const app = createServedApp(real.base);
  const exits: unknown[] = [];

  try {
    await app.onDaemonExited(value => exits.push(value));
    await app.subscribe(() => {});
    await expect.poll(() => real.subscriptions.length).toBe(1);
    real.subscriptions[0]!.end();
    await expect.poll(() => exits).toEqual([{ path: real.dir, code: null }]);
  } finally { await real.close(); }
});

it("u3791b_served_rpc_preserves_event_error_data_and_identity", async () => {
  const failure = { code: -32009, message: "arbitrary diagnostic", data: { kind: "events-expired" as const, oldest: 6 } };
  const real = await fixture(0, failure);

  try {
    const rejected = await createServedApp(real.base).rpc("daemon.ping", null).then(
      () => null,
      (error: unknown) => error,
    );
    expect(rejected).toBeInstanceOf(RpcError);
    expect(rejected).toMatchObject(failure);
  } finally { await real.close(); }
});

it("x14_harness_output_relay_selects_exact_bytes", async () => {
  const real = await fixture();

  try {
    const first = await real.select("A");
    const second = await real.select("B");
    const received = Promise.all([buffer(first.response), buffer(second.response)]);

    // Each socket is one selection: the relay preserves arbitrary binary chunks.
    first.socket.write(output("A", [0, 27, 255, 226], 0));
    second.socket.write(output("B", [66, 0], 0));
    first.socket.end(output("A", [130, 172, 128], 4));
    second.socket.end();

    expect((await received).map(bytes => Array.from(bytes))).toEqual([[0, 27, 255, 226, 130, 172, 128], [66, 0]]);
    expect([first, second].map(({ response }) => [response.statusCode, response.headers["content-type"], response.headers["x-terminal"], response.headers["x-output-after"]]))
      .toEqual([[200, "application/octet-stream", "A", "0"], [200, "application/octet-stream", "B", "0"]]);
  } finally { await real.close(); }
});

it("x14_harness_output_relay_is_bounded_without_blocking_control", async () => {
  const real = await fixture();

  try {
    const { response, socket } = await real.select("A");
    response.pause();
    const bytes = Buffer.alloc(16_384, 97);
    let sent = 0;
    let pendingWrite = false;
    const socketClosed = new Promise<void>((resolve) => socket.once("close", resolve));

    // Respect socket backpressure. A completed write is the send barrier; a
    // pending write after HTTP saturation proves the dedicated connection holds.
    const flood = (async () => {
      for (; sent < 4096 && !socket.destroyed; sent++) {
        const written = socket.write(output("A", bytes, sent * bytes.length));

        if (!written) {
          const drain = once(socket, "drain");
          pendingWrite = true;
          await Promise.race([drain, socketClosed]);
          pendingWrite = false;
        }
      }
    })().catch(() => {});

    await expect.poll(() => real.responses[0]!.writableNeedDrain && pendingWrite, { timeout: 10_000 }).toBe(true);
    expect(sent).toBeLessThan(4096);
    expect(real.responses[0]!.writableLength).toBeLessThanOrEqual(real.responses[0]!.writableHighWaterMark + 196_608);
    const before = sent;
    // A reply barrier proves control works while output is stalled, rather than
    // measuring elapsed time or assuming a particular kernel socket capacity.
    const rpc = await bound(fetch(`${real.base}/__daemon/rpc`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ method: "daemon.ping" }) }));
    expect(await rpc.json()).toEqual({ result: "control-reply" });
    expect(sent - before).toBeLessThan(32);
    expect([socket.destroyed, response.destroyed]).toEqual([false, false]);
    expect(real.responses[0]!.writableNeedDrain).toBe(true);
    response.destroy();
    await bound(socketClosed);
    await bound(flood);

    // Recovery is explicit: discontinuous bytes fail the body before a second
    // payload can be joined to it. A fresh selection supplies a new after.
    const selected = await real.select("gap");
    const chunks: Buffer[] = [];
    selected.response.on("data", (chunk: Buffer) => chunks.push(chunk));
    const closed = new Promise<void>((resolve) => selected.response.once("close", resolve));
    selected.socket.write(output("gap", [65], 0));
    await expect.poll(() => Buffer.concat(chunks).length).toBe(1);
    selected.socket.write(output("gap", [67], 2));
    await bound(closed);
    expect(Buffer.concat(chunks)).toEqual(Buffer.from([65]));
    expect(selected.response.complete).toBe(false);
    const marked = await real.select("marked");
    const closedByGap = new Promise<void>((resolve) => marked.response.once("close", resolve));

    marked.response.resume();
    marked.socket.write(gap("marked", 0, 9));
    await bound(closedByGap);
    expect(marked.response.complete).toBe(false);
    const oversized = await real.select("oversized");
    const rejected = new Promise<void>((resolve) => oversized.response.once("close", resolve));

    oversized.response.resume();
    oversized.socket.write(" ".repeat(262_145));
    await bound(rejected);
    expect(oversized.response.complete).toBe(false);
  } finally { await real.close(); }
}, 30_000);

it("x14_harness_output_relay_cancellation_is_isolated", async () => {
  const real = await fixture();

  try {
    const first = await real.select("A");
    const other = await real.select("B");
    const otherBytes: Buffer[] = [];
    other.response.on("data", (chunk: Buffer) => otherBytes.push(chunk));
    const global = await bound(fetch(`${real.base}/__daemon/events`));
    const events = global.body!.getReader();
    const ready = await bound(events.read());
    expect(new TextDecoder().decode(ready.value)).toContain('"ready":true');
    const globalSocket = real.subscriptions[2]!;
    const released = once(first.socket, "close");
    first.response.destroy();
    await bound(released);
    expect(first.socket.destroyed).toBe(true);
    const replacement = await real.select("A");
    const replacementBytes: Buffer[] = [];
    replacement.response.on("data", (chunk: Buffer) => replacementBytes.push(chunk));
    // A fixture-owned old socket cannot send late data into the replacement.
    first.socket.write(output("A", [88], 0));
    replacement.socket.write(output("A", [78], 0));
    other.socket.write(output("B", [66], 0));
    globalSocket.write(JSON.stringify({ method: "event", params: { name: "rail.changed" } }) + "\n");
    expect(new TextDecoder().decode((await bound(events.read())).value)).toContain('"rail.changed"');
    await events.cancel();
    await expect.poll(() => Buffer.concat(otherBytes)).toEqual(Buffer.from([66]));
    await expect.poll(() => Buffer.concat(replacementBytes)).toEqual(Buffer.from([78]));
    const releasedReplacement = once(replacement.socket, "close");
    replacement.response.destroy();
    await bound(releasedReplacement);
    other.socket.write(output("B", [67], 1));
    await expect.poll(() => Buffer.concat(otherBytes)).toEqual(Buffer.from([66, 67]));
    expect((await bound(fetch(`${real.base}/__daemon/output?terminal=A`, { headers: { Origin: "https://foreign.example" } }))).status).toBe(403);

    const foreign = await bound(new Promise<number>((resolve, reject) => {
      request(`${real.base}/__daemon/output?terminal=A`, { headers: { Host: "foreign.example" } }, (res) => { res.resume(); resolve(res.statusCode!); }).on("error", reject).end();
    }));

    expect(foreign).toBe(403);
    expect((await bound(fetch(`${real.base}/__daemon/output?terminal=`))).status).toBe(400);
    expect((await bound(fetch(`${real.base}/__daemon/output?terminal=missing`))).status).toBe(404);
  } finally { await real.close(); }
}, 30_000);

it("u2773a_harness_page_lifecycle_releases_and_restores_streams", async () => {
  const real = await fixture();
  const page = new EventTarget();
  vi.stubGlobal("window", page);
  const app = createServedApp(real.base);
  const events: unknown[] = [];
  const messages: unknown[] = [];
  const exits: unknown[] = [];

  try {
    await app.onDaemonExited(value => exits.push(value));
    await app.subscribe(event => events.push(event));
    const selected = await app.selectOutput("A", value => messages.push("gap" in value ? value : Array.from(value)));
    await expect.poll(() => real.subscriptions.length).toBe(2);
    real.subscriptions[1]!.write(output("A", [65, 66]));
    await expect.poll(() => messages).toEqual([[65, 66]]);

    for (let cycle = 0; cycle < 2; cycle++) {
      const sockets = real.subscriptions.slice(-2);
      const closed = sockets.map(socket => once(socket, "close"));
      page.dispatchEvent(new Event("pagehide"));

      if (cycle === 0) page.dispatchEvent(new Event("pageshow"));
      await bound(Promise.all(closed));
      expect(await app.rpc("daemon.ping", null)).toBe("control-reply");

      if (cycle === 1) page.dispatchEvent(new Event("pageshow"));
      await expect.poll(() => real.subscriptions.length).toBe(4 + cycle * 2);
      const [eventSocket, outputSocket] = real.subscriptions.slice(-2);
      eventSocket!.write([1, 2].map(seq => JSON.stringify({jsonrpc:"2.0", method:"event", params:{seq: cycle * 2 + seq, actor:{kind:"user",id:"you",parent:null}, name:"rail.changed"}}) + "\n").join(""));
      outputSocket!.write(output("A", [67 + cycle], 0));
      await expect.poll(() => events.length).toBe((cycle + 1) * 2);
      await expect.poll(() => messages.length).toBe(3 + cycle * 2);
      expect(events).toEqual(Array.from({length: (cycle + 1) * 2}, (_, i) => ({seq: i + 1, actor:{kind:"user",id:"you",parent:null}, name:"rail.changed"})));
      expect(messages.slice(-2)).toEqual([{gap:{from: cycle === 0 ? 2 : 1, to:0}}, [67 + cycle]]);
    }

    const closed = real.subscriptions.slice(-2).map(socket => once(socket, "close"));
    page.dispatchEvent(new Event("pagehide"));
    await selected.release();
    await bound(Promise.all(closed));
    page.dispatchEvent(new Event("pageshow"));
    page.dispatchEvent(new Event("pageshow"));
    await expect.poll(() => real.subscriptions.length).toBe(7);
    real.subscriptions[6]!.write(JSON.stringify({jsonrpc:"2.0", method:"event", params:{seq:5, actor:{kind:"user",id:"you",parent:null}, name:"rail.changed"}}) + "\n");
    await expect.poll(() => events.length).toBe(5);
    expect(messages).toHaveLength(5);
    expect(exits).toEqual([]);
    expect(await app.rpc("daemon.ping", null)).toBe("control-reply");
  } finally {
    page.dispatchEvent(new Event("pagehide"));
    vi.unstubAllGlobals();
    await real.close();
  }
}, 60_000);

it("u2773a_harness_output_reconnect_keeps_offsets_across_page_restore", async () => {
  const real = await fixture(7);
  const page = new EventTarget();
  vi.stubGlobal("window", page);
  const app = createServedApp(real.base);
  const messages: unknown[] = [];

  try {
    const selected = await app.selectOutput("A", value => messages.push("gap" in value ? value : Array.from(value)));
    expect(selected.offset).toBe(7);
    real.subscriptions[0]!.write(output("A", [65], 7));
    await expect.poll(() => messages).toEqual([[65]]);
    real.subscriptions[0]!.write(gap("A", 8, 11));
    await expect.poll(() => real.subscriptions.length).toBe(2);
    real.subscriptions[1]!.write(output("A", [66, 67], 7));
    await expect.poll(() => messages).toEqual([[65], {gap:{from:8,to:7}}, [66,67]]);
    const closed = once(real.subscriptions[1]!, "close");
    page.dispatchEvent(new Event("pagehide"));
    await bound(closed);
    page.dispatchEvent(new Event("pageshow"));
    await expect.poll(() => real.subscriptions.length).toBe(3);
    real.subscriptions[2]!.write(output("A", [68], 7));
    await expect.poll(() => messages).toEqual([[65], {gap:{from:8,to:7}}, [66,67], {gap:{from:9,to:7}}, [68]]);
    await selected.release();
  } finally {
    page.dispatchEvent(new Event("pagehide"));
    vi.unstubAllGlobals();
    await real.close();
  }
}, 30_000);
