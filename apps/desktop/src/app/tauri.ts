import { Channel, convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { InvokeArgs, InvokeOptions } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import * as v from "valibot";
import type { Event as DaemonEvent } from "@contracts/Event";
import { methodNotFoundMessage } from "./contractMatch";
import { daemonExitedSchema, INTERNAL_CODE, listedProjectSchema, projectSchema, RpcError } from "./seam";
import type { App, OutputMessage } from "./seam";

const METHOD_NOT_FOUND = -32601;

const parseFailure = v.safeParser(v.object({ code: v.number(), message: v.string() }));

/**
 * Every request the adapter makes into Tauri goes through here, so a failure reaches the webview as an RpcError:
 * a command rejects with `{code, message}`; the dialog, window and event plugins reject with a plain string,
 * which becomes INTERNAL. Anything else thrown inside `work` (a malformed answer) is INTERNAL with its message.
 */
const guarded = async <Result>(work: () => Promise<Result>): Promise<Result> => {
  try {
    return await work();
  } catch (raw) {
    const failure = parseFailure(raw);

    throw failure.success
      ? new RpcError(failure.output.code, failure.output.message)
      : new RpcError(INTERNAL_CODE, raw instanceof Error ? raw.message : String(raw));
  }
};

/**
 * The type argument is trusted, not checked, so use it only for `rpc` and `subscribe`: their types are
 * generated from the Daemon's own Rust types, so a mismatch is a contract bug, not bad input.
 */
const command = <Result>(name: string, args: InvokeArgs): Promise<Result> =>
  guarded(() => invoke<Result>(name, args));

/** For the hand-written App seam types: the answer is parsed, and a malformed one is an INTERNAL RpcError. */
const parsedCommand = <Schema extends v.GenericSchema>(
  schema: Schema,
  name: string,
  args: InvokeArgs,
  options?: InvokeOptions,
): Promise<v.InferOutput<Schema>> => guarded(async () => v.parse(schema, await invoke(name, args, options)));

/**
 * Tauri types the drop point as physical pixels, but wry on macOS passes the NSView's points through unscaled
 * (`wkwebview/drag_drop.rs`, `draggingLocation`; `tauri-runtime-wry` wraps them in `PhysicalPosition` as they are),
 * which already are CSS pixels. Other platforms report physical pixels, so only they divide by the ratio.
 */
const dropScale = (platform: string, ratio: number): number => (/mac/i.test(platform) ? 1 : ratio);

/** The webview lays out in CSS pixels; `ratio` is the divisor the platform's drop point needs. */
export const tauriFileDrop = (
  webview: () => Pick<ReturnType<typeof getCurrentWebview>, "onDragDropEvent">,
  ratio: () => number,
): App["onFileDrop"] => (listener) =>
  guarded(() =>
    webview().onDragDropEvent(({ payload }) => {
      if (payload.type === "leave") {
        listener({ phase: "leave", paths: [], x: 0, y: 0 });

        return;
      }

      const scale = ratio() || 1;

      listener({
        phase: payload.type === "drop" ? "drop" : "over",
        paths: payload.type === "drop" ? payload.paths : [],
        x: payload.position.x / scale,
        y: payload.position.y / scale,
      });
    }),
  );

export const createTauriApp = (): App => {
  // The live subscription of each Terminal: a replaced or released one is no longer the current, so its late messages and its late stop are inert.
  const selections = new Map<string, object>();

  const app: App = {
    projects: () => parsedCommand(v.array(listedProjectSchema), "projects", {}),
    openProject: (path) => parsedCommand(projectSchema, "open_project", { path }),
    closeProject: async (path) => {
      await command("close_project", { path });
    },
    renameProject: (path, name, base) => parsedCommand(projectSchema, "rename_project", base === undefined ? { path, name } : { path, name, base }),
    chooseProjectPath: () => guarded(() => open({ directory: true, multiple: false })),
    chooseSavePath: (suggestedName) => guarded(() => save({ defaultPath: suggestedName })),
    setDockBadge: (count) => guarded(() => getCurrentWindow().setBadgeCount(count === 0 ? undefined : count)),
    setWindowTitle: (title) => command<void>("plugin:window-bar|set_window_title", { title }),
    dragWindow: () => command<void>("plugin:window-bar|drag_window", {}),
    zoomWindow: () => command<void>("plugin:window-bar|zoom_window", {}),
    imageUrl: (path) => convertFileSrc(path),
    openTarget: async (target) => {
      await command("open_target", { target });
    },
    openInEditor: async (path, line) => {
      await command("open_in_editor", line === undefined ? { path } : { path, line });
    },
    // The bytes are the request body and the type a header, so a screenshot is not sent as a JSON list.
    savePastedImage: ({ type, bytes }) => parsedCommand(v.string(), "save_pasted_image", bytes, { headers: { type } }),
    onFileDrop: tauriFileDrop(getCurrentWebview, () => dropScale(navigator.platform, window.devicePixelRatio)),
    onDaemonExited: (listener) =>
      guarded(() => listen("daemon-exited", (event) => listener(v.parse(daemonExitedSchema, event.payload)))),
    forProject: (path) => ({
      ...app,
      daemonProof: () => parsedCommand(v.string(), "daemon_proof", { path }),
      rpc: async (method, params) => {
        try {
          return await command("rpc", { path, method, params });
        } catch (failure) {
          throw failure instanceof RpcError && failure.code === METHOD_NOT_FOUND
            ? new RpcError(failure.code, methodNotFoundMessage(method))
            : failure;
        }
      },
      subscribe: async (onEvent) => {
        await command("subscribe", { path, channel: new Channel<DaemonEvent>(onEvent) });
      },
      selectOutput: async (id, listener) => {
        const key = JSON.stringify([path, id]);
        const token = {};

        // Raw bodies arrive as ArrayBuffer and are passed on as the same bytes; only a gap is a JSON message.
        const channel = new Channel<ArrayBuffer | Extract<OutputMessage, { gap: unknown }>>((message) => {
          if (selections.get(key) !== token) return;

          listener("gap" in message ? message : new Uint8Array(message));
        });

        selections.set(key, token);

        try {
          const offset = await command<number>("terminal_output", { path, id, channel });

          return {
            offset,
            release: async () => {
              if (selections.get(key) !== token) return;

              selections.delete(key);
              await command("terminal_output_stop", { path, id });
            },
          };
        } catch (failure) {
          if (selections.get(key) === token) selections.delete(key);

          throw failure;
        }
      },
    }),
  };

  return app;
};
