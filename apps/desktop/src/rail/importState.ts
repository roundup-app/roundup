import { batch, createSignal } from "solid-js";
import * as v from "valibot";
import type { ImportDiscovery } from "@contracts/project/ImportDiscovery";
import type { ImportPeriod } from "@contracts/project/ImportPeriod";
import type { ImportSelection } from "@contracts/project/ImportSelection";
import type { AppSeam } from "../app/seam";
import { storedValue } from "../state/storage";

const PERIODS = ["day", "week", "month"] as const;

const savedSchema = v.object({
  open: v.boolean(),
  period: v.picklist(PERIODS),
  selected: v.array(v.object({ source: v.string(), revision: v.string(), title: v.string() })),
});

/** U2875d: the import panel's state for one Project. The period and the unsubmitted selection are kept per Project path and restored unverified: only the user's confirm after a refresh submits. */
export const createImport = (app: AppSeam, path: string, onOpened: (workstream: string) => void) => {
  const store = storedValue(`roundup:import:${path}`, savedSchema);
  const saved = store.read();
  const [open, setOpen] = createSignal(saved?.open ?? false);
  const [period, setPeriodSignal] = createSignal<ImportPeriod>(saved?.period ?? "week");
  const [selected, setSelected] = createSignal<ReadonlyMap<string, { revision: string; title: string }>>(new Map(saved?.selected.map((entry) => [entry.source, entry]) ?? []));
  const [discovery, setDiscovery] = createSignal<ImportDiscovery | null>(null);
  const [verified, setVerified] = createSignal(false);
  const [stale, setStale] = createSignal<string[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [pending, setPending] = createSignal(false);
  const [retentionFailure, setRetentionFailure] = createSignal<string | null>(null);
  const [failure, setFailure] = createSignal<string | null>(null);
  const [failed, setFailed] = createSignal<ReadonlyMap<string, string>>(new Map());
  let latest = 0;

  const persist = () => {
    setRetentionFailure(store.write({ open: open(), period: period(), selected: [...selected()].map(([source, entry]) => ({ source, ...entry })) }));
  };

  const refresh = async () => {
    const mine = ++latest;
    setLoading(true);
    setFailure(null);

    try {
      const found = await app.rpc("project.importDiscover", { period: period() });

      if (mine !== latest) return;

      batch(() => {
        const keep = new Map<string, { revision: string; title: string }>();
        const dropped: string[] = [];

        for (const [source, entry] of selected()) {
          const now = found.candidates.find((candidate) => candidate.source === source);

          if (now?.revision === entry.revision) keep.set(source, entry);
          else dropped.push(entry.title);
        }

        setDiscovery(found);
        setSelected(keep);
        setStale(dropped);
        setVerified(true);
        persist();
      });
    } catch (error) {
      if (mine === latest) setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      if (mine === latest) setLoading(false);
    }
  };

  return {
    open, period, selected, discovery, verified, stale, loading, pending, failure, failed, retentionFailure,
    retryStorage: persist,
    show: () => { setOpen(true); persist(); void refresh(); },
    cancel: () => { latest++; batch(() => { setOpen(false); setSelected(new Map()); setDiscovery(null); setVerified(false); setStale([]); setFailed(new Map()); setFailure(null); setLoading(false); }); persist(); },
    refresh,
    setPeriod: (next: ImportPeriod) => { setPeriodSignal(next); persist(); void refresh(); },
    choose: (source: string, title: string, revision: string, chosen: boolean) => {
      const next = new Map(selected());

      if (chosen) next.set(source, { revision, title });
      else next.delete(source);
      setSelected(next);
      persist();
    },
    confirm: async () => {
      if (pending() || !verified() || selected().size === 0) return;
      setPending(true);
      setFailure(null);
      const submitted = new Map(selected());
      const selections: ImportSelection[] = [...submitted].map(([source, entry]) => ({ source, revision: entry.revision }));

      try {
        const { outcomes } = await app.rpc("project.importCommit", { selections });
        const refused = new Map<string, string>();
        const created: string[] = [];

        for (const outcome of outcomes) {
          if (outcome.error !== null) refused.set(outcome.source, outcome.error);
          else if (outcome.workstream !== null) created.push(outcome.workstream);
        }

        batch(() => {
          const rest = new Map(selected());

          for (const outcome of outcomes) {
            if (outcome.error === null && outcome.workstream !== null && rest.get(outcome.source) === submitted.get(outcome.source)) rest.delete(outcome.source);
          }

          setSelected(rest);
          setFailed(refused);

          if (rest.size === 0) { setOpen(false); setDiscovery(null); setVerified(false); }
        });
        persist();

        if (created[0] !== undefined) onOpened(created[0]);
      } catch (error) {
        setFailure(error instanceof Error ? error.message : String(error));
      } finally {
        setPending(false);
      }
    },
  };
};

export type ImportState = ReturnType<typeof createImport>;
