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

const form = v.object({ period: v.picklist(PERIODS), sources: v.array(v.string()), revisions: v.array(v.string()) });

const savedSchema = v.object({
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
  const previous = () => drafts?.list().filter((entry) => entry.destination.surface === "import" && entry.destination.object === path).at(-1);
  const retained = previous();
  const parsed = v.safeParse(form, retained?.value);

  const saved = restored.status === "restored" ? restored.value : parsed.success ? {
    open: false, period: parsed.output.period, selected: parsed.output.sources.map((source, at) => ({ source, revision: parsed.output.revisions[at] ?? "", title: source })),
  } : null;

  let draftRevision = retained?.revision;

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
  let periodEdited = false;
  let latest = 0;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const invalidate = () => { latest++; clearTimeout(deadline); };

  const persist = () => {
    if (restoreFailure()) return;
    const retained = drafts?.edit(destination, { period: period(), sources: [...selected().keys()], revisions: [...selected().values()].map((entry) => entry.revision) }, null, "ordinary");
    draftRevision = retained?.draft.revision;
    const failure = store.write({ open: open(), period: period(), selected: [...selected()].map(([source, entry]) => ({ source, ...entry })) });
    setRetentionFailure(failure ?? retained?.problem?.cause ?? null);
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
    open, period, selected, discovery, verified, stale, loading, pending, failure, failed, retentionFailure, restoreFailure,
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

      if (restoreFailure()) {
        const result = store.restore();

        if (result.status === "failed") return;

        if (result.status === "restored") {
          if (!periodEdited) setPeriodSignal(result.value.period);
          setSelected(new Map([...result.value.selected.map((entry) => [entry.source, entry] as const), ...selected()]));
          setVerified(false);
        }

        setRestoreFailure(false);
      }

      persist();
    },
    show: () => {
      if (selected().size === 0) {
        const retained = previous();
        const parsed = v.safeParse(form, retained?.value);

        if (parsed.success && retained?.status !== "draft") {
          setPeriodSignal(parsed.output.period);
          setSelected(new Map(parsed.output.sources.map((source, at) => [source, { revision: parsed.output.revisions[at] ?? "", title: source }])));
        }
      }

      setOpen(true); persist(); void refresh();
    },
    cancel: () => {
      if (pending()) return;
      invalidate();

      if (draftRevision) drafts?.discard(draftRevision);
      batch(() => {
        setPeriodSignal("week"); setOpen(false); setSelected(new Map()); setDiscovery(null);
        setVerified(false); setStale([]); setFailed(new Map()); setFailure(null); setLoading(false);
      });

      if (!restoreFailure()) setRetentionFailure(store.write({ open: false, period: period(), selected: [] }));
      draftRevision = undefined;
    },
    refresh,
    setPeriod: (next: ImportPeriod) => { if (pending() || next === period()) return; periodEdited = true; setSelected(new Map()); setFailed(new Map()); setPeriodSignal(next); persist(); void refresh(); },
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
