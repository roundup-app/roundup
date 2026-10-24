import { batch, createSignal } from "solid-js";
import { copy } from "../copy";
import * as v from "valibot";
import type { ImportDiscovery } from "@contracts/project/ImportDiscovery";
import type { ImportPeriod } from "@contracts/project/ImportPeriod";
import type { ImportSelection } from "@contracts/project/ImportSelection";
import type { AppSeam } from "../app/seam";
import { storedValue, type draftStorage } from "../state/storage";
import { INTERNAL_CODE, RpcError } from "../app/seam";

const PERIODS = ["day", "week", "month"] as const;

const form = v.object({ period: v.picklist(PERIODS), sources: v.array(v.string()), revisions: v.array(v.string()), titles: v.optional(v.array(v.string())), external: v.optional(v.boolean()) });

const savedSchema = v.object({
  revision: v.optional(v.string()),
  open: v.boolean(),
  period: v.picklist(PERIODS),
  selected: v.array(v.object({ source: v.string(), revision: v.string(), title: v.string() })),
});

/** U2875d: the import panel's state for one Project. The period and the unsubmitted selection are kept per Project path and restored unverified: only the user's confirm after a refresh submits. */
export const createImport = (app: AppSeam, path: string, onOpened: (workstream: string, agent: string | null) => void, drafts?: ReturnType<typeof draftStorage>) => {
  const store = storedValue(`roundup:import:${path}`, savedSchema);
  const restored = store.restore();

  drafts?.validate("import", form);

  const destination = { surface: "import", object: path, recipient: null };
  const versions = () => drafts?.list().filter((entry) => entry.destination.surface === "import" && entry.destination.object === path) ?? [];
  const previous = () => versions().at(-1);
  const retained = previous();
  const parsed = v.safeParse(form, retained?.value);

  const record = restored.status === "restored" ? restored.value : null;
  // A snapshot cannot revive a revision explicitly discarded from its Project holder.
  const usable = record !== null && (!drafts || !record.revision || drafts.problem() !== null || versions().some(entry => entry.revision === record.revision));

  const saved = usable ? record : parsed.success ? {
    open: false, period: parsed.output.period, selected: parsed.output.sources.map((source, at) => ({ source, revision: parsed.output.revisions[at] ?? "", title: parsed.output.titles?.[at] ?? copy.importUnnamed })),
  } : null;

  let draftRevision = record && usable ? versions().find(entry => {
    const parsed = v.safeParse(form, entry.value);

    return record.revision ? entry.revision === record.revision : parsed.success && parsed.output.period === record.period
      && JSON.stringify(parsed.output.sources.map((source, at) => ({ source, revision: parsed.output.revisions[at] ?? "", title: parsed.output.titles?.[at] ?? copy.importUnnamed }))) === JSON.stringify(record.selected);
  })?.revision : retained?.revision;

  let baseline = JSON.stringify(record);

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
  const [restoreFailure, setRestoreFailure] = createSignal(restored.status === "failed");
  let latest = 0;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const invalidate = () => { latest++; clearTimeout(deadline); };

  const choices = () => versions().flatMap(entry => {
    const parsed = v.safeParse(form, entry.value);

    return parsed.success ? [{ revision: entry.revision, status: entry.status, ...parsed.output }] : [];
  });

  const hasConflict = () => choices().length > 1 && (choices().some(entry => entry.external) || choices().filter(entry => entry.status === "draft").length > 1);
  const value = () => ({ external: hasConflict() || choices().some(entry => entry.external), period: period(), sources: [...selected().keys()], revisions: [...selected().values()].map(entry => entry.revision), titles: [...selected().values()].map(entry => entry.title) });

  // The Import record is a second writer's input, not a cache we may replace blindly.
  // Retain it in the existing Project revision holder before advancing our baseline.
  const readExternal = () => {
    const result = store.restore();

    if (result.status === "failed") {
      setRestoreFailure(true);

      return false;
    }

    const saved = result.status === "restored" ? result.value : null;
    const next = JSON.stringify(saved);

    if (next !== baseline && saved) {
      if (saved.revision && !versions().some(entry => entry.revision === saved.revision)) {
        const problem = drafts?.retry();

        if (problem?.cause === "changed") drafts?.retry();
      }

      const external = { period: saved.period, sources: saved.selected.map(entry => entry.source), revisions: saved.selected.map(entry => entry.revision), titles: saved.selected.map(entry => entry.title) };
      const known = choices().some(entry => JSON.stringify({ period: entry.period, sources: entry.sources, revisions: entry.revisions, titles: entry.titles }) === JSON.stringify(external));

      if (!known) drafts?.edit(destination, { ...external, external: true }, null, "ordinary", null);
    }

    baseline = next;
    setRestoreFailure(false);

    return true;
  };

  const persist = (edit = true) => {
    const readable = readExternal();
    const retained = edit ? drafts?.edit(destination, value(), null, "ordinary", draftRevision ?? null) : null;

    if (retained) draftRevision = retained.draft.revision;

    if (!readable) return;

    const problem = retained?.problem ?? drafts?.problem();

    if (problem) {
      setRetentionFailure(problem.cause);

      return;
    }

    const next = { revision: draftRevision, open: open(), period: period(), selected: [...selected()].map(([source, entry]) => ({ source, ...entry })) };
    const failure = store.write(next);
    setRetentionFailure(failure);

    if (!failure) baseline = JSON.stringify(next);
  };

  const restoreChoice = (revision: string) => {
    const choice = choices().find(entry => entry.revision === revision);

    if (!choice || pending()) return;

    invalidate();
    draftRevision = revision;
    batch(() => {
      setPeriodSignal(choice.period);
      setSelected(new Map(choice.sources.map((source, at) => [source, { revision: choice.revisions[at] ?? "", title: choice.titles?.[at] ?? source }])));
      setOpen(true); setDiscovery(null); setVerified(false); setLoading(false); setStale([]); setFailed(new Map()); setFailure(null);
    });
    persist(false);
  };

  const refresh = async () => {
    invalidate();
    const mine = latest;
    deadline = setTimeout(() => {
      if (mine !== latest) return;
      invalidate();
      batch(() => { setLoading(false); setFailure(copy.importTimeout); });
    }, 20_000);
    setDiscovery(null);
    setVerified(false);
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
      if (mine === latest) { clearTimeout(deadline); setLoading(false); }
    }
  };

  return {
    open, period, selected, discovery, verified, stale, loading, pending, failure, failed, retentionFailure, restoreFailure, choices, hasConflict,
    restoreChoice,
    discardChoice: (revision: string) => {
      if (pending()) return;
      persist(false);
      drafts?.discard(revision);

      if (draftRevision === revision) {
        draftRevision = undefined;
        const remaining = choices().at(-1);

        if (remaining) {
          restoreChoice(remaining.revision);

          return;
        }

        setSelected(new Map()); setPeriodSignal("week"); setVerified(false);
      }

      persist(false);
    },
    reconnect: (nextApp: AppSeam, nextOpened: typeof onOpened) => {
      app = nextApp;
      onOpened = nextOpened;
      invalidate();
      setLoading(false);
      setDiscovery(null);
      setVerified(false);
    },
    retryStorage: () => {
      drafts?.retry();

      persist(false);
    },
    show: () => {
      if (open()) return;

      if (selected().size === 0) {
        const retained = previous();
        const parsed = v.safeParse(form, retained?.value);

        if (parsed.success && retained?.status !== "draft") {
          setPeriodSignal(parsed.output.period);
          setSelected(new Map(parsed.output.sources.map((source, at) => [source, { revision: parsed.output.revisions[at] ?? "", title: parsed.output.titles?.[at] ?? copy.importUnnamed }])));
        }
      }

      setOpen(true); persist(); void refresh();
    },
    cancel: () => {
      if (pending()) return;
      invalidate();
      persist();

      setOpen(false);
      setLoading(false);
      persist(false);
    },
    refresh,
    setPeriod: (next: ImportPeriod) => { if (pending() || next === period()) return; setSelected(new Map()); setFailed(new Map()); setPeriodSignal(next); persist(); void refresh(); },
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
      const submittedRevision = draftRevision;

      if (submittedRevision) drafts?.submit(submittedRevision);

      const selections: ImportSelection[] = [...submitted].map(([source, entry]) => ({ source, revision: entry.revision }));

      try {
        const { outcomes } = await app.rpc("project.importCommit", { selections });
        const refused = new Map<string, string>();
        const created: { workstream: string; agent: string | null }[] = [];

        for (const outcome of outcomes) {
          if (outcome.error !== null) refused.set(outcome.source, outcome.error);
          else if (outcome.workstream !== null) created.push({ workstream: outcome.workstream, agent: outcome.agent });
        }

        if (submittedRevision) drafts?.settle(submittedRevision, refused.size === 0 ? "acknowledged" : "failed");
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

        if (refused.size > 0) await refresh();

        if (created[0] !== undefined) onOpened(created[0].workstream, created[0].agent);
      } catch (error) {
        if (submittedRevision) drafts?.settle(submittedRevision, error instanceof RpcError && error.code !== -32004 && error.code !== INTERNAL_CODE ? "failed" : "unknown");
        setFailure(error instanceof Error ? error.message : String(error));
      } finally {
        setPending(false);
      }
    },
  };
};
