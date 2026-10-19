import * as v from "valibot";
import { createSignal } from "solid-js";
import type { Events } from "../../app/events";
import { draftStorage, storedValue } from "../../state/storage";

const layoutSchema = v.object({
  selected: v.nullable(v.string()),
  collapsed: v.array(v.string()),
});

type SavedLayout = v.InferOutput<typeof layoutSchema>;

export type RailStorage = {
  read(): SavedLayout | null;
  write(layout: SavedLayout): string | null;
};

export const railStorage = (path: string): RailStorage => storedValue(`roundup:rail:${path}`, layoutSchema);

type Drafts = ReturnType<typeof draftStorage>;

const drafts = new WeakMap<Events, ReturnType<typeof createDrafts>>();

const createDrafts = (project: string) => {
  const storage = draftStorage(project);
  const [records, setRecords] = createSignal(storage.list());
  const [problem, setProblem] = createSignal(storage.problem());
  const refresh = () => { setRecords(storage.list()); setProblem(storage.problem()); };

  return {
    records, problem,
    edit: (...args: Parameters<Drafts["edit"]>) => {
      const result = storage.edit(...args);
      refresh();

      return result.draft;
    },
    submit: (revision: string) => {
      const result = storage.submit(revision);
      refresh();

      return result?.draft ?? null;
    },
    settle: (...args: Parameters<Drafts["settle"]>) => { storage.settle(...args); refresh(); },
    discard: (revision: string) => { storage.discard(revision); refresh(); },
    retry: () => { storage.retry(); refresh(); },
  };
};

/** The rail uses the existing Project draft storage, shared by its task, names and Clear. */
export const draftsOf = (events: Events, project: string) => {
  let found = drafts.get(events);

  if (!found) {
    found = createDrafts(project);
    drafts.set(events, found);
  }

  return found;
};
