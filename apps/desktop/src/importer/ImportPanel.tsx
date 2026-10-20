import "./import.css";
import { createEffect, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import { Portal } from "solid-js/web";
import * as v from "valibot";
import type { ImportCandidate } from "@contracts/project/ImportCandidate";
import type { ImportDiscovery } from "@contracts/project/ImportDiscovery";
import type { ImportPeriod } from "@contracts/project/ImportPeriod";
import { copy } from "../copy";
import { ErrorLine } from "../ink/ErrorLine";
import { registerKeys } from "../keys/registry";
import { useConnectedProject } from "../state/connectedProject";
import { Dialog } from "../ui/Dialog";

const SURFACE = "import";

const PERIODS: readonly ImportPeriod[] = ["day", "week", "month"];

const form = v.object({
  period: v.picklist(PERIODS),
  sources: v.array(v.string()),
  revisions: v.array(v.string()),
});

/** A draft holds scalars and flat arrays only, so the selection is two parallel lists. */
const packed = (selected: ReadonlyMap<string, string>) => ({ sources: [...selected.keys()], revisions: [...selected.values()] });

/** U2875d: the Project's `Import Claude Code work` panel. Opening discovers; nothing submits until `Import` is pressed, and a restored selection waits for a fresh discovery to match it. */
export const ImportPanel = (props: { open: boolean; opener: HTMLElement | undefined; onClose: () => void }) => {
  const { app, drafts, project, rail } = useConnectedProject();
  const destination = { surface: SURFACE, object: project.path, recipient: null };
  drafts.validate(SURFACE, form);
  const release = drafts.editor(destination);
  onCleanup(release);

  const parsed = v.safeParse(form, drafts.list().filter((draft) => draft.destination.surface === SURFACE
    && draft.destination.object === project.path && draft.status === "draft").at(-1)?.value);

  const saved = parsed.success ? parsed.output : null;

  const [period, setPeriod] = createSignal<ImportPeriod>(saved ? saved.period : "week");
  const [wanted, setWanted] = createSignal(new Map((saved?.sources ?? []).map((source, at) => [source, saved?.revisions[at] ?? ""])));
  const [found, setFound] = createSignal<ImportDiscovery | null>(null);
  const [failure, setFailure] = createSignal<string | null>(null);
  const [refused, setRefused] = createSignal<ReadonlyMap<string, string>>(new Map());
  const [pending, setPending] = createSignal(false);
  const [stale, setStale] = createSignal(0);
  let ticket = 0;
  let panel: HTMLElement | undefined;
  let radios: HTMLDivElement | undefined;
  registerKeys({ kind: "layer", element: () => panel, active: () => props.open, modal: true }, []);

  createEffect(() => { if (props.open) void untrack(() => discover()); });

  const keep = (): void => {
    if (wanted().size === 0 && period() === "week") drafts.discard(drafts.list().find((draft) => draft.destination.surface === SURFACE
      && draft.destination.object === project.path && draft.status === "draft")?.revision ?? "");
    else drafts.edit(destination, { period: period(), ...packed(wanted()) }, null, "ordinary");
  };

  const discover = async (keep: ReadonlyMap<string, string> = new Map()): Promise<void> => {
    const mine = ++ticket;
    setFound(null);
    setFailure(null);

    try {
      const result = await app.rpc("project.importDiscover", { period: period() });

      if (mine !== ticket) return;
      setFound(result);
      const current = new Map(result.candidates.map((candidate) => [candidate.source, candidate.revision]));
      const changed = [...wanted()].flatMap(([source, revision]): [string, string][] => current.get(source) === revision ? [] : [[source, copy.importChanged]]);
      setWanted((previous) => new Map([...previous].filter(([source, revision]) => current.get(source) === revision)));
      setStale(changed.length);
      setRefused(new Map([...changed, ...keep]));
    } catch (error) {
      if (mine === ticket) setFailure(error instanceof Error ? error.message : String(error));
    }
  };

  const toggle = (candidate: ImportCandidate): void => {
    if (pending()) return;
    setWanted((previous) => {
      const next = new Map(previous);

      if (next.has(candidate.source)) next.delete(candidate.source);
      else next.set(candidate.source, candidate.revision);

      return next;
    });
    keep();
  };

  const choose = (next: ImportPeriod): void => {
    if (pending() || next === period()) return;
    setPeriod(next);
    setWanted(new Map());
    keep();
    void discover();
  };

  const confirm = async (): Promise<void> => {
    if (pending() || wanted().size === 0) return;
    const selections = [...wanted()].map(([source, revision]) => ({ source, revision }));
    const retained = drafts.edit(destination, { period: period(), ...packed(wanted()) }, null, "ordinary").draft;
    drafts.submit(retained.revision);
    setPending(true);
    setFailure(null);

    try {
      const result = await app.rpc("project.importCommit", { selections });
      const failed = result.outcomes.filter((outcome) => outcome.error !== null);
      const first = result.outcomes.find((outcome) => outcome.error === null && outcome.workstream !== null);

      if (failed.length === 0) {
        drafts.settle(retained.revision, "acknowledged");
        reset();
        props.onClose();

        if (first) {
          await rail.refresh();
          rail.select(first.agent ?? first.workstream);
        }

        return;
      }

      drafts.settle(retained.revision, "failed");
      const left = new Set(failed.map((outcome) => outcome.source));
      const reasons = new Map(failed.map((outcome): [string, string] => [outcome.source, outcome.error ?? ""]));
      setWanted((previous) => new Map([...previous].filter(([source]) => left.has(source))));
      keep();
      await discover(reasons);
    } catch (error) {
      drafts.settle(retained.revision, "failed");
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  };

  const reset = (): void => {
    ticket += 1;
    setStale(0);
    setWanted(new Map());
    setRefused(new Map());
    setPeriod("week");
    setFound(null);
  };

  const dismiss = (): void => {
    if (pending()) return;
    const draft = drafts.list().find((entry) => entry.destination.surface === SURFACE && entry.destination.object === project.path);

    if (draft) drafts.discard(draft.revision);
    reset();
    props.onClose();
  };

  return (
    <Dialog.Root open={props.open} initialFocusEl={() => radios?.querySelector<HTMLElement>("[aria-checked=true]") ?? null} finalFocusEl={() => props.opener?.isConnected ? props.opener : null}
      onOpenChange={(details) => { if (!details.open) dismiss(); }}>
      <Portal><Dialog.Backdrop /><Dialog.Positioner class="import-positioner">
        <Dialog.Content class="import-panel" ref={(element) => (panel = element)}>
          <Dialog.Title>{copy.importTitle}</Dialog.Title>
          <div role="radiogroup" aria-label={copy.importPeriod} class="import-period" ref={radios}>
            <For each={PERIODS}>{(each) => (
              <button type="button" role="radio" data-button="quiet" aria-checked={period() === each} onClick={() => choose(each)}>
                {copy.importPeriodName(each)}
              </button>
            )}</For>
          </div>
          <Show when={failure()}>{(message) => <ErrorLine message={message()} />}</Show>
          <Show when={found()} fallback={<Show when={!failure()}><p role="status">{copy.importLooking}</p></Show>}>
            {(result) => <>
              <Show when={result().candidates.length === 0}><p role="status">{copy.importNone}</p></Show>
              <Show when={stale() > 0}><p role="status">{copy.importStale(stale())}</p></Show>
              <ul class="import-list" aria-label={copy.importResults}>
                <For each={result().candidates}>{(candidate) => (
                  <li>
                    <label>
                      <input type="checkbox" class="todo-tick import-check" checked={wanted().has(candidate.source)} disabled={pending()} onChange={() => toggle(candidate)} />
                      <span class="import-text">
                        <span class="import-title">{candidate.title}</span>
                        <span class="import-cwd">{candidate.cwd === "" ? copy.importProjectFolder : candidate.cwd}</span>
                      </span>
                    </label>
                    <Show when={refused().get(candidate.source)}>{(reason) => <p role="alert" data-tone="red">{reason()}</p>}</Show>
                  </li>
                )}</For>
              </ul>
            </>}
          </Show>
          <p class="import-words">
            <button data-button="quiet" type="button" class="word" onClick={() => void discover()} disabled={pending()}>{copy.importRefresh}</button>
            <span class="import-actions">
              <button data-button="quiet" type="button" class="word" onClick={dismiss}>{copy.cancel}</button>
              <button data-button="quiet" type="button" class="word import-confirm" disabled={pending() || wanted().size === 0} onClick={() => void confirm()}>
                {copy.importConfirm(wanted().size)}
              </button>
            </span>
          </p>
        </Dialog.Content>
      </Dialog.Positioner></Portal>
    </Dialog.Root>
  );
};
