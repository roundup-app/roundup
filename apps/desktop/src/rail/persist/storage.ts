import type { ConnectedProject } from "../../state/connectedProject";
import * as v from "valibot";
import { storedValue } from "../../state/storage";

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

type Drafts = ConnectedProject["drafts"];

/** A narrow Rail view of the connected Project’s single reactive draft holder. */
export const draftsOf = (storage: Drafts) => {
  return {
    records: storage.list, problem: storage.problem,
    edit: (...args: Parameters<Drafts["edit"]>) => {
      const result = storage.edit(...args);

      return result.draft;
    },
    submit: (revision: string) => {
      const result = storage.submit(revision);

      return result?.draft ?? null;
    },
    settle: (...args: Parameters<Drafts["settle"]>) => { storage.settle(...args); },
    discard: (revision: string) => { storage.discard(revision); },
    retry: () => { storage.retry(); },
  };
};
