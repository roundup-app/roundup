import { createEffect, createMemo, createSignal, untrack } from "solid-js";
import type { ChangedFile } from "@contracts/agent/ChangedFile";
import { moduleKey } from "./ChangedTree";
import type { Lens } from "./lens";
import type { Grouped } from "./modules";
import { isChanged, isViewed, mark, nextUnviewed, progressOf, reconcile, unmark, type Seen } from "./viewed";

/** U7680: the Agent's Viewed marks for the open comparison: the modules that show them, the header's count, and the mark that opens the next item. `open` takes the view to a module of a lens. */
export const createViewed = (input: { memory: { seen: Seen }; comparison: () => string; files: () => readonly ChangedFile[]; settled: () => boolean; lensed: () => (each: Lens) => Grouped; lens: () => Lens; opened: () => string | undefined; open: (to: { lens: Lens; key: string }) => void }) => {
  const [seen, setSeen] = createSignal(untrack(() => input.memory.seen));

  const remember = (next: Seen) => {
    input.memory.seen = next;
    setSeen(next);
  };

  // U7680d: a listing that shows a marked file with another blob removes its mark; a listing still pending or failed removes none.
  createEffect(() => ({ listed: input.files(), settled: input.settled(), at: input.comparison() }), ({ listed, settled, at }) => { if (settled) remember(reconcile(untrack(seen), at, listed)); });

  const modules = (each: Lens) => input.lensed()(each).modules;
  const keysOf = (has: (files: readonly ChangedFile[]) => boolean) => new Set(modules(input.lens()).filter(module => has(module.files)).map(module => moduleKey(module.name)));
  const viewedKeys = createMemo(() => keysOf(files => isViewed(seen(), input.comparison(), files)));
  const changedKeys = createMemo(() => keysOf(files => isChanged(seen(), input.comparison(), files)));
  const progress = createMemo(() => progressOf(seen(), input.comparison(), modules(input.lens())));

  const find = (key: string, each: Lens) => modules(each).find(module => moduleKey(module.name) === key);

  // U7680a, U7680b: marking the module `key` of lens `each` opens the next one not viewed, in this lens and then the lenses after it; pressing again un-marks and moves nothing.
  const toggle = (key: string, each: Lens) => {
    const module = find(key, each);

    if (!module) return;
    const at = input.comparison();

    if (isViewed(seen(), at, module.files)) {
      remember(unmark(seen(), at, module.files));

      return;
    }

    const marked = mark(seen(), at, module.files);

    remember(marked);

    const next = nextUnviewed(each, key, other => modules(other).map(entry => ({ key: moduleKey(entry.name), viewed: isViewed(marked, at, entry.files) })));

    if (next) input.open(next);
  };

  /** V: the open item, when it is a module. */
  const markOpen = () => {
    const key = input.opened();

    if (key !== undefined) toggle(key, input.lens());
  };

  /** The open module's header: its state and the button's press. */
  const head = (key: string, each: Lens) => {
    const module = find(key, each);

    return module && { on: isViewed(seen(), input.comparison(), module.files), changed: isChanged(seen(), input.comparison(), module.files), toggle: () => toggle(key, each) };
  };

  return { viewedKeys, changedKeys, progress, markOpen, head };
};
