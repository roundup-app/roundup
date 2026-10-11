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
};

/** The Tauri commands of `scenarios/app.md` and `scenarios/project-tabs.md`, plus the macOS choosers and the Dock badge; the only door from the webview to Tauri. */
export type App = {
  /** The open Projects in tab order. */
  projects(): Promise<ListedProject[]>;
  openProject(path: string): Promise<Project>;
  /** Ends the Project's Daemon and its Agents and Terminals. */
  closeProject(path: string): Promise<void>;
  /** Stores `name` for the Project; an empty name returns it to its folder's name (S10). */
  renameProject(path: string, name: string): Promise<Project>;
  /** Resolves `null` when the user cancels the macOS chooser. */
  chooseProjectPath(): Promise<string | null>;
  /** The macOS save chooser, with `suggestedName` filled in; resolves `null` on cancel. */
  chooseSavePath(suggestedName: string): Promise<string | null>;
  /** Shows `count` on the Dock icon; zero clears the badge. */
  setDockBadge(count: number): Promise<void>;
  /** The URL the webview loads the image file at the absolute `path` from (U352); the file is read by the webview, not the Daemon. */
  imageUrl(path: string): string;
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
