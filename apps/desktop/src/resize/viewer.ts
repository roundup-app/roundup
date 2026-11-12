import { createComputed, createRoot, createSignal, on, untrack } from "solid-js";
import * as v from "valibot";
import { storageOpened, storageSchema, storedValue } from "../state/storage";

const finite = v.pipe(v.number(), v.finite());

const schema = storageSchema("roundup:viewer", v.object({
  rail: v.optional(v.fallback(finite, 288), 288),
  shelf: v.optional(v.fallback(finite, 320), 320),
  collapsed: v.optional(v.fallback(v.boolean(), false), false),
  /** The Shelf's own choices; `open` missing means the caller's default, a tab that is neither tab means `todos`. */
  frame: v.optional(v.fallback(v.object({
    maximised: v.optional(v.boolean(), true),
    open: v.optional(v.boolean()),
    tab: v.optional(v.fallback(v.picklist(["todos", "pads"]), "todos")),
  }), { maximised: true })),
  /** Each Drawer surface's maximised choice by surface kind. */
  surfaces: v.optional(v.fallback(v.record(v.string(), v.boolean()), {}), {}),
  /** The Rail's collapsed head-groups. */
  sections: v.optional(v.fallback(v.array(v.picklist(["workstreams", "modes", "agents"])), []), []),
}));

export type Viewer = v.InferOutput<typeof schema>;

const storage = storedValue("roundup:viewer", schema);

const [written, setWritten] = createSignal<Viewer | null>(null);

// A reopened store is the truth again; what this App wrote is read back from it.
createRoot(() => createComputed(on(storageOpened, () => setWritten(null), { defer: true })));

/** U100, U389, U390, U370, U373, U4698a: the viewer state, stored once for the App, so every Project shows the same layout. */
export const viewer = (): Viewer => {
  storageOpened();

  return written() ?? storage.read() ?? v.parse(schema, {});
};

let pending = 0;

/** Keeps part of the viewer state for every Project; a failed write leaves the shown state as the user made it. */
export const saveViewer = (patch: Partial<Viewer>): void => {
  const next = { ...untrack(viewer), ...patch };

  setWritten(next);
  pending += 1;
  void storage.write(next).then((failure) => {
    pending -= 1;

    // The stored record is the truth once every write has landed; a refused write keeps what the user made.
    if (pending === 0 && failure === null) setWritten(null);
  });
};
