import * as v from "valibot";
import type { Event as DaemonEvent } from "@contracts/Event";
import { INTERNAL_CODE, projectSchema, RpcError } from "../app/seam";
import type { AppSeam, DaemonExited } from "../app/seam";

const outcomeSchema = v.union([
  v.object({ result: v.unknown() }),
  v.object({ error: v.object({ code: v.number(), message: v.string() }) }),
]);

const openSchema = v.object({ project: projectSchema, proof: v.string() });

const frameSchema = v.union([
  v.object({ ready: v.literal(true) }),
  v.object({ event: v.unknown() }),
  v.object({ exited: v.nullable(v.number()) }),
]);

/**
 * The AppSeam of `harness.html?daemon=1` (U144): `rpc` and `subscribe` go to the dev server's `/__daemon/` routes,
 * which relay them to a running `rupd`; the default choosers answer `null` and the Dock badge does nothing.
 * U463 opts into first-run with a choice callback; it can only choose the configured Project or cancel.
 */
export const createServedApp = (base: string, choice?: () => "choose" | "cancel"): AppSeam => {
  let projectOpened = choice === undefined;
  const exits = new Set<(exit: DaemonExited) => void>();
  let exited: DaemonExited | null = null;

  const exit = async (code: number | null) => {
    if (exited) return;

    exited = { path: (await open).project.path, code };
    exits.forEach((listener) => listener(exited!));
  };

  const open = (async () => {
    const response = await fetch(`${base}/__daemon/open`);

    return v.parse(openSchema, await response.json());
  })();

  const reach = async <Result>(work: () => Promise<Result>): Promise<Result> => {
    try {
      return await work();
    } catch (raw) {
      if (raw instanceof RpcError) throw raw;

      throw new RpcError(INTERNAL_CODE, raw instanceof Error ? raw.message : String(raw));
    }
  };

  const rpc: AppSeam["rpc"] = (method, params) =>
    reach(async () => {
      const response = await fetch(`${base}/__daemon/rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, params }),
      });

      const outcome = v.parse(outcomeSchema, await response.json());

      if ("error" in outcome) throw new RpcError(outcome.error.code, outcome.error.message);

      // SAFETY: the Daemon's result for `method` is the generated contract type, as the Tauri adapter trusts it.
      return outcome.result as never;
    });

  const selectOutput: AppSeam["selectOutput"] = (id, listener) =>
    reach(async () => {
      let released = false;
      let controller = new AbortController();

      const open = async (): Promise<{ body: ReadableStream<Uint8Array>; offset: number }> => {
        controller = new AbortController();

        const response = await fetch(`${base}/__daemon/output?terminal=${encodeURIComponent(id)}`, { signal: controller.signal });

        if (!response.ok || !response.body) {
          const failure = v.safeParse(v.object({ error: v.object({ code: v.number(), message: v.string() }) }), await response.json().catch(() => null));

          throw failure.success ? new RpcError(failure.output.error.code, failure.output.error.message) : new RpcError(INTERNAL_CODE, `terminal output answered ${response.status}`);
        }

        return { body: response.body, offset: Number(response.headers.get("x-output-after")) };
      };

      // The relay fails a stream it cannot continue exactly (a gap, an overlarge frame); a fresh selection resumes it and the listener hears what was skipped.
      const pump = async (current: { body: ReadableStream<Uint8Array>; offset: number }): Promise<void> => {
        let position = current.offset;

        try {
          const reader = current.body.getReader();

          for (;;) {
            const { value, done } = await reader.read();

            if (done || released) return;

            position += value.length;
            listener(value);
          }
        } catch {
          if (released) return;

          try {
            const next = await open();

            if (released) return;

            listener({ gap: { from: position, to: next.offset } });
            await pump(next);
          } catch {
            // The Daemon is gone or the Terminal has exited: the stream ends and the Project's exit says why.
          }
        }
      };

      const first = await open();

      void pump(first);

      return {
        offset: first.offset,
        release: async () => {
          released = true;
          controller.abort();
        },
      };
    });

  const app: AppSeam = {
    projects: () =>
      reach(async () => {
        const { project } = await open;

        return projectOpened ? [{ ...project, running: !exited }] : [];
      }),
    closeProject: async () => {
      throw new RpcError(-32003, "the served Daemon cannot be closed");
    },
    renameProject: (path, name) =>
      reach(async () => {
        const { project } = await open;

        return path === project.path ? { ...project, name: name.trim() || project.name } : project;
      }),
    forProject: () => app,
    openProject: (path) =>
      reach(async () => {
        const { project } = await open;

        if (path !== project.path) throw new RpcError(-32003, "a Project is already open");

        projectOpened = true;

        return project;
      }),
    daemonProof: () =>
      reach(async () => {
        if (exited) throw new RpcError(INTERNAL_CODE, "the Daemon exited");

        return (await open).proof;
      }),
    chooseProjectPath: () => reach(async () => choice?.() === "choose" ? (await open).project.path : null),
    chooseSavePath: async () => null,
    setDockBadge: async () => {},
    // The isolated browser has no native window; these calls never move or rename a host window.
    setWindowTitle: async () => {},
    dragWindow: async () => {},
    zoomWindow: async () => {},
    openTarget: async () => {},
    openInEditor: async () => {
      throw new RpcError(-32001, "no code editor found; install VS Code or Cursor, or set ROUNDUP_EDITOR");
    },
    savePastedImage: async () => "/tmp/roundup-pasted/pasted.png",
    rpc,
    selectOutput,
    subscribe: (onEvent) =>
      reach(
        () =>
          new Promise<void>((ready, fail) => {
            void (async () => {
              try {
                const response = await fetch(`${base}/__daemon/events`);
                const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
                let pending = "";
                let subscribed = false;

                for (;;) {
                  const { value, done } = await reader.read();

                  if (done) break;
                  pending += value;

                  for (let end = pending.indexOf("\n"); end >= 0; end = pending.indexOf("\n")) {
                    const frame = v.parse(frameSchema, JSON.parse(pending.slice(0, end)));

                    pending = pending.slice(end + 1);

                    if ("ready" in frame) {
                      subscribed = true;
                      ready();
                    } else if ("event" in frame) {
                      // SAFETY: the Daemon's pushed Events are the generated contract type, as the Tauri adapter trusts them.
                      onEvent(frame.event as DaemonEvent);
                    } else void exit(frame.exited);
                  }
                }

                if (!subscribed) fail(new RpcError(INTERNAL_CODE, "the Daemon closed before the subscription"));
                void exit(null);
              } catch (error) {
                fail(error);
                void exit(null);
              }
            })();
          }),
      ),
    imageUrl: (path) => `file://${path}`,
    onFileDrop: async () => () => {},
    onDaemonExited: async (listener) => {
      exits.add(listener);

      if (exited) listener(exited);

      return () => void exits.delete(listener);
    },
  };

  return app;
};

/** E10: the question the model fixtures answer; a spawn without a prompt types nothing (A9), so a fixture's Agent is spawned with it as its first prompt. */
const FIXTURE_PROMPT = "What should this Agent do?";

/** Spawn an Agent under `parent` whose first prompt is `FIXTURE_PROMPT`; its turns then play the fixture's entry. */
export const spawnPrompted = (app: AppSeam, cwd: string, parent: string) => app.rpc("agent.spawn", { cwd, prompt: FIXTURE_PROMPT, parent });
