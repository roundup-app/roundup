import pRetry from "p-retry";
import * as v from "valibot";
import type { RpcErrorData } from "@contracts/RpcErrorData";
import type { IdleEvidence } from "../perf/idle.ts";
import type { Event as DaemonEvent } from "@contracts/Event";
import type { RpcMethodName, RpcMethods } from "@contracts/methods";

/** Hand-written App seam types (`scenarios/app.md`), not generated from Rust, so the adapter parses them. */
export const projectSchema = v.object({ name: v.string(), path: v.string() });

/** U3813: a native command with its captured selected Project. */
export const projectPageSchema = v.object({ path: v.string(), command: v.string() });

/** One entry of `projects`, in tab order (S8): `running` is false once that Project's Daemon exited. */
export const listedProjectSchema = v.object({ name: v.string(), path: v.string(), running: v.boolean() });

const daemonExitSchema = v.object({
  code: v.nullable(v.number()),
  /** Omitted only after automatic recovery is exhausted. */
  recovery: v.optional(v.picklist(["waiting", "connecting"])),
  cause: v.optional(v.string()),
});

/** The `daemon-exited` event, which names the Project whose Daemon ended (S8). */
export const daemonExitedSchema = v.object({ path: v.string(), ...daemonExitSchema.entries });

export type ListedProject = v.InferOutput<typeof listedProjectSchema>;

export type DaemonExited = v.InferOutput<typeof daemonExitedSchema>;

export type Project = v.InferOutput<typeof projectSchema>;

export type DaemonExit = v.InferOutput<typeof daemonExitSchema>;

/** Native requests are delivered once after the main consumer is ready; links remain opaque. */
export const nativeOpenSchema = v.variant("kind", [
  v.object({ kind: v.literal("project"), path: v.string() }),
  v.object({ kind: v.literal("link"), url: v.string() }),
]);

export type NativeOpen = v.InferOutput<typeof nativeOpenSchema>;

export type Unsubscribe = () => void;

/** One step of a File drop: `x` and `y` in CSS pixels of the webview; `paths` absolute, empty unless `phase` is `drop`. */
export type FileDrop = { phase: "over" | "drop" | "leave"; paths: string[]; x: number; y: number };

/** What Cmd+click on a Terminal's link asks the App to open (U365): a web link, or an absolute path with the line it was printed with. */
export type OpenTarget = { kind: "url"; url: string } | { kind: "path"; path: string; line: number | null };

/** U2694a: one item of a native menu. Both menus use one-step accelerators and separate sequence hints; adjacent context groups receive native separators. Project groups are create, navigate and views. `children` makes a native submenu in either menu. */
export type MenuItem = { id: string; label: string; shortcut?: string; group?: string; enabled: boolean; children?: MenuItem[] };

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
  rpc<M extends RpcMethodName>(
    method: M,
    params: RpcMethods[M]["params"],
  ): Promise<RpcMethods[M]["result"]>;
  /**
   * Every Event the Project's Daemon emits from now on arrives at `onEvent`, in the Daemon's order; with `after`, every saved Event numbered above it arrives first (D11).
   * Resolves the Daemon's `head`, the highest Event number saved when it accepted.
   */
  subscribe(onEvent: (event: DaemonEvent) => void, after?: number): Promise<number>;
  /** Delivers the raw output of the Terminal `id`, and of no other, to `listener` in order; a second call for the same Terminal replaces the first. Rejects NOT_FOUND for an unknown or exited Terminal. */
  selectOutput(id: string, listener: (message: OutputMessage) => void): Promise<OutputSubscription>;
};

/** All Tauri commands, including the R24 feature-only command; M5 checks each has a tool or a reason. Normal-build exclusion is probed separately. */
export const SEAM_COMMANDS = [
  "ask_removal",
  "plugin:capture-panel|control",
  "native_open",
  "projects",
  "recent_projects",
  "claude_binary",
  "record_idle_evidence",
  "select_project_menu",
  "open_project",
  "close_project",
  "rename_project",
  "rpc",
  "subscribe",
  "terminal_output",
  "terminal_output_stop",
  "open_target",
  "open_in_editor",
  "save_pasted_image",
  "plugin:clipboard-manager|write_text",
  "show_context_menu",
  "plugin:window-bar|set_window_title",
  "plugin:window-bar|native_material",
  "plugin:window-bar|drag_window",
  "plugin:window-bar|zoom_window",
] as const;

/** U3787f: the panel displays the main window's Capture owner; it stores no drafts. */
export const captureStateSchema = v.object({
  session: v.string(), sequence: v.number(), text: v.string(), owner: v.string(), home: v.string(),
  recovered: v.array(v.object({ revision: v.string(), text: v.string(), status: v.string(), label: v.string() })),
  retention: v.boolean(), failure: v.nullable(v.string()), mode: v.picklist(["dark", "light"]),
});

export const captureActionSchema = v.variant("kind", [
  v.object({ kind: v.literal("ready") }),
  v.object({ kind: v.literal("edit"), session: v.string(), sequence: v.number(), text: v.string() }),
  v.object({ kind: v.literal("file"), session: v.string(), sequence: v.number(), text: v.string(), keepOpen: v.boolean() }),
  v.object({ kind: v.literal("dismiss"), session: v.string() }),
  v.object({ kind: v.literal("discard"), session: v.string() }),
  v.object({ kind: v.literal("copy"), session: v.string(), revision: v.string() }),
  v.object({ kind: v.literal("discard-revision"), session: v.string(), revision: v.string() }),
  v.object({ kind: v.literal("retry"), session: v.string() }),
]);

export type CaptureState = v.InferOutput<typeof captureStateSchema>;

export type CaptureAction = v.InferOutput<typeof captureActionSchema>;

export type CapturePort = {
  configure(press: string | null): Promise<void>;
  show(): Promise<void>;
  dismiss(): Promise<void>;
  publish(snapshot: CaptureState): Promise<void>;
  act(action: CaptureAction): Promise<void>;
  onRequested(listener: () => void): Promise<Unsubscribe>;
  onAction(listener: (action: CaptureAction) => void): Promise<Unsubscribe>;
  onState(listener: (snapshot: CaptureState) => void): Promise<Unsubscribe>;
};

/** A captured system question with complete consequences and named affirmative/cancel buttons. */
export type RemovalAnswer = "this" | "all" | "cancel";

export type RemovalQuestion = { title: string; message: string; thisLabel: string; allLabel: string; cancelLabel: string };

export type NativeQuestion = { title: string; message: string; okLabel: string; cancelLabel: string };

/** The Tauri commands of `scenarios/app.md` and `scenarios/project-tabs.md`, plus the macOS choosers and the Dock badge; the only door from the webview to Tauri. */
export const claudeBinarySchema = v.object({ path: v.string(), version: v.string() });

export type App = {
  recentProjects(): Promise<string[]>;
  claudeBinary(): Promise<v.InferOutput<typeof claudeBinarySchema> | null>;
  /** Initial macOS accent and later preference changes; null selects the Radix fallback. */
  capture?: CapturePort | undefined;
  onNativeOpen?: ((listener: (request: NativeOpen) => void) => Promise<Unsubscribe>) | undefined;
  /** R24 measurement builds alone provide this bounded native evidence sink. */
  recordIdleEvidence?: ((record: IdleEvidence) => Promise<void>) | undefined;
  /** U3560a: write exactly this text to the native clipboard; rejects with the platform cause. */
  writeClipboardText(text: string): Promise<void>;
  /** A system alert; false (including Escape) authorizes nothing. Plugin failure rejects as RpcError. */
  ask(question: NativeQuestion): Promise<boolean>;
  askRemoval(question: RemovalQuestion): Promise<RemovalAnswer>;
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
  /** Pops the macOS system menu at `x`, `y` (window CSS pixels) and resolves the chosen item's id, or `null` when it closes with no choice (U2694a). */
  showContextMenu(items: MenuItem[], x: number, y: number): Promise<string | null>;
  /** Reports the window's native File drop, which Tauri takes before the webview sees a DOM `drop`. */
  onFileDrop(listener: (drop: FileDrop) => void): Promise<Unsubscribe>;
  /** Synchronizes native Project-menu availability with the selected tab. */
  selectProjectMenu(path: string | null, items?: MenuItem[]): Promise<void>;
  /** Native commands carry the selected Project captured by the host at activation. */
  onProjectPage(listener: (page: { path: string; command: string }) => void): Promise<Unsubscribe>;
  /** Opens the app-wide center settings view; no payload. */
  onAppSettings(listener: () => void): Promise<Unsubscribe>;
  onDaemonExited(listener: (exit: DaemonExited) => void): Promise<Unsubscribe>;
  /** The calls into that Project's Daemon, with its path filled in. */
  forProject(path: string): AppSeam;
};

/** What a region of an open Project calls: the App's choosers and badge, and its own Project's Daemon. */
export type AppSeam = App & ProjectCalls;

export const INTERNAL_CODE = -32603;

/** Unknown or malformed optional data cannot authorize Event recovery; keep the error identity. */
export const rpcFailureSchema = v.object({
  code: v.number(),
  message: v.string(),
  data: v.fallback(v.optional(v.variant("kind", [
    v.object({ kind: v.literal("events-expired"), oldest: v.pipe(v.number(), v.safeInteger(), v.minValue(1)) }),
    v.object({ kind: v.literal("other-project") }),
    v.object({ kind: v.literal("undo-parent"), id: v.string(), name: v.string() }),
    v.object({ kind: v.literal("undo-identity"), id: v.string(), name: v.string() }),
    v.object({ kind: v.literal("undo-pad-name"), name: v.string() }),
  ])), undefined),
});

/** A failed call: the Daemon's own `code` and `message`, or INTERNAL when Tauri, a plugin or a malformed answer failed. */
export class RpcError extends Error {
  readonly code: number;
  readonly data: RpcErrorData | undefined;

  constructor(code: number, message: string, data?: RpcErrorData) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.data = data;
  }
}

const refusals = new Set([-32700, -32601, -32602, -32001, -32002, -32003, -32005, -32007, -32009, -32010]);

/** Only a typed refusal proves a remote mutation failed; all other throws preserve uncertainty. */
// U3791b: this is the foreign-throw ingestion seam; even primitives must retain uncertainty.
// oxlint-disable-next-line anti-slop/no-unknown-parameters
export const outcomeOf = (thrown: unknown): "failed" | "unknown" =>
  thrown instanceof RpcError && refusals.has(thrown.code) ? "failed" : "unknown";


/** Foreign reads get one additional attempt; no caller can change the retry budget.
 * Normalize TypeError because p-retry otherwise retries only network TypeErrors.
 */
export const retryRead = <T>(read: () => Promise<T>): Promise<T> => pRetry(async () => {
  try {
    return await read();
  } catch (thrown) {
    if (thrown instanceof TypeError) throw new Error(thrown.message, { cause: thrown });

    if (thrown instanceof Error) throw thrown;

    throw new RpcError(INTERNAL_CODE, String(thrown));
  }
}, { retries: 1, minTimeout: 0, maxTimeout: 0 });
