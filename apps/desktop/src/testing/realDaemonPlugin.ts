import { connect } from "node:net";
import type { Socket } from "node:net";
import { pipeline } from "node:stream";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as v from "valibot";
import type { Plugin } from "vite";

/** What the dev server serves of one running `rupd` (U144). */
export type RealDaemon = {
  /** The Project path the Daemon serves. */
  project: string;
  /** The Daemon's socket, as `rpc::socket_path` resolves it. */
  socket: string;
};

const ROUTE = "/__daemon";

const RPC_BOUND_MS = 60_000;

const INTERNAL = -32603;

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** `rpc::socket_path`: `RUPD_SOCKET` if set, else `~/.roundup/rupd.sock`. */
const socketPath = (env: NodeJS.ProcessEnv): string => env.RUPD_SOCKET ?? join(env.HOME ?? homedir(), ".roundup/rupd.sock");

/** `just harness-real` names its Project in the environment; no name, no Daemon routes. */
export const realDaemonFromEnv = (env: NodeJS.ProcessEnv): RealDaemon | null =>
  env.ROUNDUP_REAL_PROJECT
    ? { project: env.ROUNDUP_REAL_PROJECT, socket: socketPath(env) }
    : null;

/** Newline-delimited JSON lines from a socket, until it closes. */
const lines = (socket: Socket, onLine: (line: string) => void, onEnd: () => void): void => {
  let pending = "";

  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    pending += chunk;

    for (let end = pending.indexOf("\n"); end >= 0; end = pending.indexOf("\n")) {
      const line = pending.slice(0, end);

      pending = pending.slice(end + 1);

      if (line) onLine(line);
    }
  });
  socket.on("close", onEnd);
  socket.on("error", () => socket.destroy());
};

type Outcome = { result: unknown } | { error: { code: number; message: string } };

const replySchema = v.object({
  id: v.optional(v.unknown()),
  method: v.optional(v.unknown()),
  params: v.optional(v.unknown()),
  result: v.optional(v.unknown()),
  error: v.optional(v.object({ code: v.number(), message: v.string() })),
});

type Params = v.InferOutput<typeof paramsSchema>;

const requestSchema = v.object({ method: v.string(), params: v.optional(v.nullable(v.record(v.string(), v.unknown()))) });

const paramsSchema = v.nullable(v.record(v.string(), v.unknown()));

const failure = (message: string): Outcome => ({ error: { code: INTERNAL, message } });

/** One request on its own connection, so a call never waits behind another and one call's hang-up ends only that call. */
const call = (daemon: RealDaemon, method: string, params: Params): Promise<Outcome> =>
  new Promise((resolve) => {
    const socket = connect(daemon.socket);
    const timer = setTimeout(() => settle(failure(`${method} did not answer within ${RPC_BOUND_MS} ms`)), RPC_BOUND_MS);
    let settled = false;

    const settle = (outcome: Outcome) => {
      if (settled) return;

      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(outcome);
    };

    socket.on("connect", () => socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })}\n`));
    lines(
      socket,
      (line) => {
        try {
          const frame = v.parse(replySchema, JSON.parse(line));

          if (frame.id !== 1) return;
          settle(frame.error ? { error: frame.error } : { result: frame.result ?? null });
        } catch {
          settle(failure("the Daemon answered with a line that is not JSON"));
        }
      },
      () => settle(failure("the connection closed before the reply; the Daemon may have run the call")),
    );
    socket.on("error", (error) => settle(failure(`the Daemon is not reachable: ${error.message}`)));
  });

const readBody = (request: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let body = "";

    request.setEncoding("utf8");
    request.on("data", (chunk: string) => (body += chunk));
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });

const json = (response: ServerResponse, status: number, body: Outcome | { error: string } | { project: { name: string; path: string } }) => {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
};

/** Streams `{ready}`, one `{event}` per Daemon Event, then `{exited}` when the socket closes. */
const stream = (daemon: RealDaemon, response: ServerResponse) => {
  const socket = connect(daemon.socket);
  const send = (frame: { event: unknown } | { ready: true } | { exited: null }) => response.write(`${JSON.stringify(frame)}\n`);
  let subscribed = false;

  response.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" });
  response.on("close", () => socket.destroy());
  socket.on("connect", () => socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "events.subscribe", params: null })}\n`));
  lines(
    socket,
    (line) => {
      try {
        const frame = v.parse(replySchema, JSON.parse(line));

        if (frame.method === "event") send({ event: frame.params });
        else if (frame.id === 1 && !frame.error && !subscribed) {
          subscribed = true;
          send({ ready: true });
        }
      } catch {
        // A line that is not JSON is dropped, as the Rust client drops it.
      }
    },
    () => {
      send({ exited: null });
      response.end();
    },
  );
};

const NOT_FOUND = -32001;

const startedSchema = v.object({ offset: v.pipe(v.number(), v.safeInteger(), v.minValue(0)) });

const outputSchema = v.object({ id: v.string(), data: v.string(), offset: v.pipe(v.number(), v.safeInteger(), v.minValue(0)) });

/** One Terminal's selected output (X14) as one binary response over one dedicated Unix socket: the Daemon's
 * `terminal.output` subscription answers with the first offset, then pushes `terminal.output` and `terminal.gap`.
 * The response starts once the Daemon has answered; `X-Output-After` is that offset and the body is the raw bytes.
 * Each request owns its connection; pipeline backpressure cannot hold an RPC.
 * See realDaemonOutput.md for bounds and the browser recovery contract. */
const output = (daemon: RealDaemon, response: ServerResponse, terminal: string) => {
  const socket = connect(daemon.socket);
  const timer = setTimeout(() => socket.destroy(new Error(`output subscription did not answer within ${RPC_BOUND_MS} ms`)), RPC_BOUND_MS);
  const maxLine = 262_144;
  let next: number | null = null;

  response.on("close", () => socket.destroy());
  socket.on("connect", () => socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "terminal.output", params: { id: terminal } })}\n`));

  socket.once("close", () => clearTimeout(timer));

  // A generator yields only when downstream requests bytes. No event callback
  // keeps writing after response.write() has signalled backpressure.
  pipeline(socket, async function* (source: AsyncIterable<Buffer>) {
    let pending = Buffer.alloc(0);

    for await (const chunk of source) {
      if (chunk.length > 65_536) throw new Error("output socket chunk exceeds bound");
      pending = Buffer.concat([pending, chunk]);

      for (let end = pending.indexOf(10); end >= 0; end = pending.indexOf(10)) {
        if (end > maxLine) throw new Error("output envelope exceeds bound");
        const line = pending.subarray(0, end);

        pending = pending.subarray(end + 1);

        if (!line.length) continue;
        const frame = v.parse(replySchema, JSON.parse(line.toString("utf8")));

        if (frame.id === 1) {
          clearTimeout(timer);

          // The Terminal is unknown or exited: nothing is streamed, and the status says why.
          if (frame.error) return void json(response, frame.error.code === NOT_FOUND ? 404 : 502, { error: frame.error });

          next = v.parse(startedSchema, frame.result).offset;
          response.writeHead(200, {
            "Content-Type": "application/octet-stream",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "X-Terminal": encodeURIComponent(terminal),
            "X-Output-After": String(next),
          });
          response.flushHeaders();

          continue;
        }

        if (frame.method === "terminal.gap") throw new Error("output gap; obtain a fresh snapshot");

        if (frame.method !== "terminal.output") continue;

        if (next === null) throw new Error("output before the subscription answered");
        const data = v.parse(outputSchema, frame.params);

        if (data.id !== terminal) throw new Error("output of another Terminal");

        if (data.offset !== next) throw new Error("output offset gap; obtain a fresh snapshot");
        const bytes = Buffer.from(data.data, "base64");

        if (bytes.toString("base64") !== data.data) throw new Error("invalid output base64");
        next += bytes.length;

        if (!Number.isSafeInteger(next)) throw new Error("output offset exceeds safe integer");
        yield bytes;
      }

      if (pending.length > maxLine) throw new Error("output envelope exceeds bound");
    }

    if (pending.length) throw new Error("incomplete output envelope");
  }, response, () => {
    // pipeline destroys both ends on failure, making fetch's reader reject.
    // No clean EOF or later selection can hide a dropped or malformed frame.
    socket.destroy();
  });
};

/** The Daemon routes of U144: loopback requests only, and only JSON `POST`s, which a web page on another origin cannot send without a preflight. */
const serve = (daemon: RealDaemon, request: IncomingMessage, response: ServerResponse, path: string) => {
  const host = (request.headers.host ?? "").replace(/:\d+$/, "");

  if (!LOOPBACK.has(request.socket.remoteAddress ?? "") || !LOCAL_HOSTS.has(host)) return json(response, 403, { error: "loopback only" });

  const origin = request.headers.origin;

  if (origin && origin !== `http://${request.headers.host}`) return json(response, 403, { error: "same origin only" });

  if (path === "output" && request.method === "GET") {
    const query = new URL(request.url ?? "/", "http://localhost").searchParams;
    const terminal = query.get("terminal");

    if (!terminal || terminal.length > 256) return json(response, 400, { error: "terminal required" });

    return output(daemon, response, terminal);
  }

  if (path === "open" && request.method === "GET") return json(response, 200, { project: { name: basename(daemon.project), path: daemon.project } });

  if (path === "events" && request.method === "GET") return stream(daemon, response);

  if (path === "rpc" && request.method === "POST") {
    if (!request.headers["content-type"]?.startsWith("application/json")) return json(response, 415, { error: "application/json only" });

    return void readBody(request).then(async (body) => {
      try {
        const { method, params } = v.parse(requestSchema, JSON.parse(body));

        json(response, 200, await call(daemon, method, params ?? null));
      } catch {
        json(response, 400, { error: "not a request" });
      }
    });
  }

  json(response, 404, { error: "no such route" });
};

/** Serves one running `rupd` to the harness page (U144); a development tool, so it has no place in `vite build`. */
export const realDaemon = (daemon: RealDaemon): Plugin => ({
  name: "roundup-real-daemon",
  apply: "serve",
  configureServer(server) {
    // Node closes an idle keep-alive socket after 5 s. A POST the client writes onto that socket in the same moment gets
    // ECONNRESET, and fetch does not retry a POST. A test worker whose loop stalls for seconds hits that moment, so the
    // relay never reaps an idle connection; the client still closes its own.
    if (server.httpServer && "keepAliveTimeout" in server.httpServer) server.httpServer.keepAliveTimeout = 0;

    server.middlewares.use(ROUTE, (request, response) => serve(daemon, request, response, (request.url ?? "/").slice(1).split("?")[0] ?? ""));
  },
});
