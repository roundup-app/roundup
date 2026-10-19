import * as v from "valibot";
import type { Event as DaemonEvent } from "@contracts/Event";
import type { RpcMethodName, RpcMethods } from "@contracts/methods";

/** Hand-written App seam types (`scenarios/app.md`), not generated from Rust, so the adapter parses them. */
export const projectSchema = v.object({ name: v.string(), path: v.string() });

/** One entry of `projects`, in tab order (S8): `running` is false once that Project's Daemon exited. */
export const listedProjectSchema = v.object({ name: v.string(), path: v.string(), running: v.boolean() });

const daemonExitSchema = v.object({ code: v.nullable(v.number()) });

/** The `daemon-exited` event, which names the Project whose Daemon ended (S8). */
export const daemonExitedSchema = v.object({ path: v.string(), ...daemonExitSchema.entries });

export type ListedProject = v.InferOutput<typeof listedProjectSchema>;

export type DaemonExited = v.InferOutput<typeof daemonExitedSchema>;

export type Project = v.InferOutput<typeof projectSchema>;

export type DaemonExit = v.InferOutput<typeof daemonExitSchema>;

export type Unsubscribe = () => void;

/** One step of a File drop: `x` and `y` in CSS pixels of the webview; `paths` absolute, empty unless `phase` is `drop`. */
export type FileDrop = { phase: "over" | "drop" | "leave"; paths: string[]; x: number; y: number };

/** What Cmd+click on a Terminal's link asks the App to open (U365): a web link, or an absolute path with the line it was printed with. */
export type OpenTarget = { kind: "url"; url: string } | { kind: "path"; path: string; line: number | null };

/** The image types `savePastedImage` accepts (U418); the file's extension follows the type. */
export const PASTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

/** An image read from the clipboard: its type and exactly its bytes. */
export type PastedImage = { type: (typeof PASTED_IMAGE_TYPES)[number]; bytes: Uint8Array };

/** One message of a Terminal's output stream: the next bytes exactly as the program wrote them, or the range `from..to` that was not delivered (the stream resumes at `to`). */
export type OutputMessage = Uint8Array | { gap: { from: number; to: number } };

/** `offset` is the position of the first byte the stream delivers. `release` ends only this subscription; after it the listener is never called. */
export type OutputSubscription = { offset: number; release(): Promise<void> };

/** The calls into one Project's Daemon, bound to its path (S8); regions use only these and the choosers. */
export type ProjectCalls = {
  /** The proof the App gave the Project's Daemon, which `decision.answer` needs (H4); keep it in memory only. Rejects when the Project is not open and after its Daemon exits. */
  daemonProof(): Promise<string>;
  rpc<M extends RpcMethodName>(
    method: M,
    params: RpcMethods[M]["params"],
  ): Promise<RpcMethods[M]["result"]>;
  /** Every Event the Project's Daemon emits from now on arrives at `onEvent`, in the Daemon's order. */
  subscribe(onEvent: (event: DaemonEvent) => void): Promise<void>;
  /** Delivers the raw output of the Terminal `id`, and of no other, to `listener` in order; a second call for the same Terminal replaces the first. Rejects NOT_FOUND for an unknown or exited Terminal. */
  selectOutput(id: string, listener: (message: OutputMessage) => void): Promise<OutputSubscription>;
};

/** The Tauri commands the App registers (`crates/desktop`), every one of them; `m5_every_app_action_has_a_tool_or_a_reason` reads this table and fails for a command without an MCP tool or a reason. */
export const SEAM_COMMANDS = [
  "projects",
  "open_project",
  "close_project",
  "rename_project",
  "rpc",
  "subscribe",
  "terminal_output",
  "terminal_output_stop",
  "daemon_proof",
  "open_target",
  "open_in_editor",
  "save_pasted_image",
  "plugin:window-bar|set_window_title",
  "plugin:window-bar|drag_window",
  "plugin:window-bar|zoom_window",
] as const;

/** The Tauri commands of `scenarios/app.md` and `scenarios/project-tabs.md`, plus the macOS choosers and the Dock badge; the only door from the webview to Tauri. */
export type App = {
  /** The open Projects in tab order. */
  projects(): Promise<ListedProject[]>;
  openProject(path: string): Promise<Project>;
  /** Ends the Project's Daemon and its Agents and Terminals. */
  closeProject(path: string): Promise<void>;
  /** Stores `name` for the Project; an empty name returns it to its folder's name (S10). */
  /** With a captured authoritative name `base`, atomically refuse CONFLICT if it changed; omission authorizes an unconditional rename. */
  renameProject(path: string, name: string, base?: string): Promise<Project>;
  /** Resolves `null` when the user cancels the macOS chooser. */
  chooseProjectPath(): Promise<string | null>;
  /** The macOS save chooser, with `suggestedName` filled in; resolves `null` on cancel. */
  chooseSavePath(suggestedName: string): Promise<string | null>;
  /** Shows `count` on the Dock icon; zero clears the badge. */
  setDockBadge(count: number): Promise<void>;
  /** Writes the full native title of the current window; a native failure rejects as RpcError. */
  setWindowTitle(title: string): Promise<void>;
  /** Requests a native drag of the current window; rejects as RpcError on failure. */
  dragWindow(): Promise<void>;
  /** Toggles native zoom of the current window; rejects as RpcError on failure. */
  zoomWindow(): Promise<void>;
  /** The URL the webview loads the image file at the absolute `path` from (U352); the file is read by the webview, not the Daemon. */
  imageUrl(path: string): string;
  /** Opens a web link in the default browser, or an absolute path in its default app (a folder in Finder). Rejects NOT_FOUND for a missing path and FORBIDDEN for a scheme but http and https (U365). */
  openTarget(target: OpenTarget): Promise<void>;
  /** Opens the absolute directory or file `path` in the user's code editor, a file at `line` when the editor takes one (U429, U2539c). Rejects NOT_FOUND for a missing path or when no editor is found, and CONFLICT for a relative path. */
  openInEditor(path: string, line?: number): Promise<void>;
  /** Saves a pasted image as a new file in the OS cache folder and resolves its absolute path (U418). Rejects FORBIDDEN for another type or bytes over 20 MiB, and writes nothing then. */
  savePastedImage(image: PastedImage): Promise<string>;
  /** Reports the window's native File drop, which Tauri takes before the webview sees a DOM `drop`. */
  onFileDrop(listener: (drop: FileDrop) => void): Promise<Unsubscribe>;
  onDaemonExited(listener: (exit: DaemonExited) => void): Promise<Unsubscribe>;
  /** The calls into that Project's Daemon, with its path filled in. */
  forProject(path: string): AppSeam;
};

/** What a region of an open Project calls: the App's choosers and badge, and its own Project's Daemon. */
export type AppSeam = App & ProjectCalls;

export const INTERNAL_CODE = -32603;

/** A failed call: the Daemon's own `code` and `message`, or INTERNAL when Tauri, a plugin or a malformed answer failed. */
export class RpcError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = "RpcError";
    this.code = code;
  }
}
