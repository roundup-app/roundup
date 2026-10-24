import { projectMenu } from "./menuProbe";
import * as v from "valibot";
import type { SpawnParams } from "@contracts/agent/SpawnParams";
import type { Event as DaemonEvent } from "@contracts/Event";
import { INTERNAL_CODE, projectSchema, RpcError } from "../app/seam";
import { probeMenu, probeQuestion } from "./menuProbe";
import type { AppSeam, DaemonExited, OutputSubscription } from "../app/seam";

const outcomeSchema = v.union([
  v.object({ result: v.unknown() }),
  v.object({ error: v.object({ code: v.number(), message: v.string() }) }),
]);

const openSchema = v.object({ project: projectSchema });

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
  const page = typeof window === "undefined" ? undefined : window;
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
      let suspended = false;
      let controller = new AbortController();
      let position: number | undefined;

      const hide = () => {
        suspended = true;
        controller.abort();
      };

      const show = () => {
        if (!suspended || released) return;

        suspended = false;
        void start();
      };

      const release = async () => {
        released = true;
        controller.abort();
        page?.removeEventListener("pagehide", hide);
        page?.removeEventListener("pageshow", show);
      };

      let ready: (value: OutputSubscription) => void;
      let fail: (error: RpcError) => void;

      const selected = new Promise<OutputSubscription>((resolve, reject) => {
        ready = resolve;
        fail = reject;
      });

      const start = async (): Promise<void> => {
        const current = new AbortController();
        controller = current;
        let streaming = false;

        try {
          const response = await fetch(`${base}/__daemon/output?terminal=${encodeURIComponent(id)}`, { signal: current.signal });

          if (!response.ok || !response.body) {
            const failure = v.safeParse(v.object({ error: v.object({ code: v.number(), message: v.string() }) }), await response.json().catch(() => null));

            throw failure.success ? new RpcError(failure.output.error.code, failure.output.error.message) : new RpcError(INTERNAL_CODE, `terminal output answered ${response.status}`);
          }

          if (current.signal.aborted) return;

          streaming = true;
          const offset = Number(response.headers.get("x-output-after"));

          if (position !== undefined) listener({ gap: { from: position, to: offset } });
          position = offset;
          ready({ offset, release });
          const reader = response.body.getReader();

          for (;;) {
            const { value, done } = await reader.read();

            if (done || current.signal.aborted) return;

            position += value.length;
            listener(value);
          }
        } catch (error) {
          if (current.signal.aborted) return;

          if (!streaming) {
            await release();
            fail(error instanceof RpcError ? error : new RpcError(INTERNAL_CODE, error instanceof Error ? error.message : String(error)));
          } else {
            // A relay gap requires a fresh selection; its offset tells the listener what was skipped.
            void start();
          }
        }
      };

      page?.addEventListener("pagehide", hide);
      page?.addEventListener("pageshow", show);
      void start();

      return selected;
    });

  const app: AppSeam = {
    writeClipboardText: async () => { throw new RpcError(-32003, "Native clipboard is unavailable in the browser harness. Use the desktop App to copy."); },
    projects: () =>
      reach(async () => {
        const { project } = await open;

        return projectOpened ? [{ ...project, running: !exited }] : [];
      }),
    closeProject: async () => {
      throw new RpcError(-32003, "the served Daemon cannot be closed");
    },
    renameProject: (path, name, base) =>
      reach(async () => {
        const { project } = await open;

        if (path !== project.path || !projectOpened) throw new RpcError(-32003, "Project is not open");

        if (base !== undefined && base !== project.name) throw new RpcError(-32003, "Project name changed");
        const trimmed = name.trim();

        if (name.includes("\n") || name.includes("\r") || Array.from(trimmed).length > 40) throw new RpcError(-32602, "invalid Project name");
        project.name = trimmed || path.split("/").filter(Boolean).at(-1) || path;

        return { ...project };
      }),
    forProject: () => app,
    openProject: (path) =>
      reach(async () => {
        const { project } = await open;

        if (path !== project.path) throw new RpcError(-32003, "a Project is already open");

        projectOpened = true;

        return { ...project };
      }),
    chooseProjectPath: () => reach(async () => choice?.() === "choose" ? (await open).project.path : null),
    chooseSavePath: async () => null,
    ask: probeQuestion,
    setDockBadge: async () => {},
    // The isolated browser has no native window; these calls never move or rename a host window.
    setWindowTitle: async () => {},
    dragWindow: async () => {},
    zoomWindow: async () => {},
    openTarget: async () => {},
    openInEditor: async () => {
      throw new RpcError(-32001, "no code editor found; install VS Code, Cursor or Zed, or set ROUNDUP_EDITOR");
    },
    showContextMenu: async (items) => probeMenu(items),
    savePastedImage: async () => "/tmp/roundup-pasted/pasted.png",
    rpc,
    selectOutput,
    subscribe: (onEvent) =>
      reach(
        () =>
          new Promise<number>((ready, fail) => {
            let suspended = false;
            let controller = new AbortController();

            const hide = () => {
              suspended = true;
              controller.abort();
            };

            const show = () => {
              if (!suspended || exited) return;

              suspended = false;
              void start();
            };

            const stop = () => {
              page?.removeEventListener("pagehide", hide);
              page?.removeEventListener("pageshow", show);
            };

            const start = async () => {
              const current = new AbortController();
              controller = current;

              try {
                const response = await fetch(`${base}/__daemon/events`, { signal: current.signal });
                const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
                let pending = "";
                let subscribed = false;

                for (;;) {
                  const { value, done } = await reader.read();

                  if (current.signal.aborted) return;

                  if (done) break;
                  pending += value;

                  for (let end = pending.indexOf("\n"); end >= 0; end = pending.indexOf("\n")) {
                    const frame = v.parse(frameSchema, JSON.parse(pending.slice(0, end)));

                    pending = pending.slice(end + 1);

                    if ("ready" in frame) {
                      subscribed = true;
                      ready(0);
                    } else if ("event" in frame) {
                      // SAFETY: the Daemon's pushed Events are the generated contract type, as the Tauri adapter trusts them.
                      onEvent(frame.event as DaemonEvent);
                    } else void exit(frame.exited);
                  }
                }

                stop();

                if (!subscribed) fail(new RpcError(INTERNAL_CODE, "the Daemon closed before the subscription"));
                void exit(null);
              } catch (error) {
                if (current.signal.aborted) return;

                stop();
                fail(error);
                void exit(null);
              }
            };

            page?.addEventListener("pagehide", hide);
            page?.addEventListener("pageshow", show);
            void start();
          }),
      ),
    imageUrl: (path) => `file://${path}`,
    selectProjectMenu: async (path) => { projectMenu.path = path; },
    onProjectPage: async (listener) => {
      const receive = (event: Event) => { if (event instanceof CustomEvent) listener(event.detail); };

      window.addEventListener("open-project-page", receive);

      return () => window.removeEventListener("open-project-page", receive);
    },
    onAppSettings: async (listener) => {
      window.addEventListener("open-app-settings", listener);

      return () => window.removeEventListener("open-app-settings", listener);
    },
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
export const spawnPrompted = (app: AppSeam, cwd: string, parent: string, name?: string) => {
  const params: SpawnParams = { cwd, prompt: FIXTURE_PROMPT, parent };

  if (name !== undefined) params.name = name;

  return app.rpc("agent.spawn", params);
};
