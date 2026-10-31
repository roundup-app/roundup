import type { draftStorage } from "../../state/storage";
import * as v from "valibot";
import { storageSchema, storedValue } from "../../state/storage";

export type RailSection = "workstreams" | "modes" | "agents";

const layoutSchema = storageSchema("roundup:rail", v.object({
  selected: v.nullable(v.string()),
  collapsed: v.array(v.string()),
  sections: v.optional(v.array(v.picklist(["workstreams", "modes", "agents"]))),
}));

type SavedLayout = v.InferOutput<typeof layoutSchema>;

export type RailStorage = {
  read(): SavedLayout | null;
  write(layout: SavedLayout): Promise<string | null>;
};

export const railStorage = (path: string): RailStorage => storedValue(`roundup:rail:${path}`, layoutSchema);

type Drafts = ReturnType<typeof draftStorage>;

/** A narrow Rail view of the connected Project’s single reactive draft holder. */
export const draftsOf = (storage: Drafts) => {
  return {
    records: storage.list, problem: storage.problem,
    edit: (...args: Parameters<Drafts["edit"]>) => {
      const result = storage.edit(...args);

      return result.draft;
    },
    submit: async (revision: string) => {
      const result = await storage.submit(revision);

      return result?.draft ?? null;
    },
    settle: (...args: Parameters<Drafts["settle"]>) => { storage.settle(...args); },
    discard: (revision: string) => { storage.discard(revision); },
    retry: () => { storage.retry(); },
  };
};

const dismissedSchema = storageSchema("roundup:dismissed", v.array(v.string()));

/** U5151c: the failures the owner dismissed in one Project. */
export const dismissalStorage = (path: string) => storedValue(`roundup:dismissed:${path}`, dismissedSchema);
