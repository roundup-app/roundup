import { createMemo, createSignal, onCleanup } from "solid-js";
import fuzzysort from "fuzzysort";
import type { settingsEntries } from "./entries";
import { registerSettingsPlace } from "./place";

/** U5243a: `fuzzysort` ranks the live entries by label, description, page and group; an entry only a link reaches is never ranked. */
export const createSettingsSearch = (entries: (viewed?: string | null) => ReturnType<typeof settingsEntries>, place: { setProject: (path: string | null) => void; setSection: (section: string) => void; show: () => void }) => {
  const [query, setQuery] = createSignal("");
  const searching = () => query().trim() !== "";
  const results = createMemo(() => searching() ? fuzzysort.go(query().trim(), entries().filter(entry => !entry.linkOnly), { keys: ["label", "description", "page", "group"] }).map(result => result.obj) : []);

  onCleanup(registerSettingsPlace({ entries, ...place, setQuery }));

  return { query, setQuery, searching, results };
};
