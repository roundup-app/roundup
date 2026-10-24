import { writeText } from "../app/clipboard";
import { ReservedLine } from "../ink/ReservedLine";
import type { ActivationSource } from "../keys/registry";
import { useConnectedProject } from "../state/connectedProject";
import type { MenuEntry } from "../ui/contextMenu";
import { copy } from "../copy";
import { createEffect, createSignal, For, Show } from "solid-js";
import { KindGlyph } from "../ink/KindGlyph";
import { usePadList } from "../rail/pads/padList";
import { useTodoList } from "../todos/todoList";
import { PadDrawer } from "../pads/PadDrawer";
import { Pads } from "../pads/Pads";
import { OrderDrawer } from "../orders/OrderDrawer";
import { todoCreationEditor, todoEditor } from "./editors";
import { typedText, useUnfinishedWork } from "./unfinishedWork";

/**
 * U3289c: the Overview row's menu item. Nothing renders unasked (U3289b); with no work at risk the item is absent.
 * Opening the panel sends no mutation (U3021c).
 */
export const useRecoveryMenu = (): ((source?: ActivationSource) => MenuEntry[]) => {
  const connected = useConnectedProject();
  const work = useUnfinishedWork();

  return (source = "pointer") => {
    const count = work.rows().length;

    return count === 0 && !work.problem() ? [] : [{
      id: "recover",
      label: count > 0 ? copy.recoverDraftsCount(count) : copy.recoverDrafts,
      run: () => connected.drawer.open(() => <DraftRecoveryPanel />, source),
    }];
  };
};

const DraftRecoveryPanel = () => {
  const { app, drafts, project, rail, drawer } = useConnectedProject();
  const pads = usePadList();
  const todos = useTodoList();
  const work = useUnfinishedWork();
  const [failures, setFailures] = createSignal<Record<string, string>>({});

  const clear = (revision: string) => setFailures(current => Object.fromEntries(Object.entries(current).filter(([key]) => key !== revision)));

  createEffect(() => {
    const revisions = new Set(drafts.list().map(draft => draft.revision));
    setFailures(current => Object.fromEntries(Object.entries(current).filter(([key]) => revisions.has(key))));
  });

  type Row = ReturnType<typeof work.rows>[number];

  const copyText = async (row: Row) => {
    try {
      await writeText(app, typedText(row.draft).join("\n"));
      clear(row.draft.revision);
    } catch (error) {
      setFailures(current => ({ ...current, [row.draft.revision]: copy.copyDraftFailure(error instanceof Error ? error.message : String(error)) }));
    }
  };

  const node = (row: Row) => rail.nodes.find((candidate) => candidate.id === (row.draft.destination.surface === "terminal_selection" ? row.draft.value.source : row.draft.destination.object));

  const title = (row: Row) => {
    const { surface, object } = row.draft.destination;

    const name = surface === "pads" ? row.draft.value.originalName
      : surface === "todos" ? todos.all().find((todo) => String(todo.id) === object)?.title
      : surface === "header" && object === project.path ? project.name : node(row)?.name;

    return { place: copy.draftSurface(surface === "rail" && node(row) ? node(row)!.kind : surface), name: String(name ?? (row.draft.policy === "credential" ? "" : typedText(row.draft)[0])).trim().split("\n")[0] ?? "" };
  };

  const open = (row: Row) => {
    const { surface, object } = row.draft.destination;

    if (surface === "pads" && row.draft.value.originalName) {
      return () => drawer.open(() => <PadDrawer name={String(row.draft.value.originalName)} pads={pads.pads} recovery={{ project: project.path, revision: row.draft.revision, list: pads }} onLateFailure={() => {}} />, "key");
    }

    const editor = todoEditor.get();

    if (surface === "todos" && editor && todos.all().some((todo) => String(todo.id) === object)) {
      return () => drawer.open(() => editor({ id: Number(object), todos, recovery: { project: project.path, revision: row.draft.revision } }), "key");
    }

    if (surface === "pads" && object === "creation") {
      return () => drawer.open(() => <Pads recovery={{ project: project.path, revision: row.draft.revision, list: pads }} />, "key");
    }

    const creation = todoCreationEditor.get();

    if (surface === "todos" && object === "new" && creation) {
      return () => drawer.open(() => creation({ recovery: { project: project.path, revision: row.draft.revision, list: todos } }), "key");
    }

    if (surface === "orders" && node(row)) {
      return () => drawer.open(() => <OrderDrawer id={object} recovery={{ project: project.path, revision: row.draft.revision }} />, "key");
    }

    const target = node(row);

    // The remaining surfaces keep their editor on screen; Open brings it into view.
    return () => { if (target) rail.select(target.id); drawer.close("key"); };
  };

  return <section class="draft-recovery" aria-label={copy.unfinishedWork}>
    <h2>{copy.unfinishedWork}</h2>
    <ReservedLine message={(drafts.problem() && !drafts.problem()!.destination?.surface.startsWith("rail-") ? copy.draftProblem(drafts.problem()!.cause) : null)}>
<Show when={drafts.problem()}><button data-button="quiet" type="button" onClick={() => drafts.retry()}>{copy.tryAgain}</button></Show>
      </ReservedLine>
    <Show when={work.rows().length} fallback={<p>{copy.noUnfinishedWork}</p>}>
      <ul class="draft-revisions">
        <For each={work.rows()}>{(row) => <li data-revision={row.draft.revision}>
          <div class="draft-destination">
            <KindGlyph kind={row.cause === "failed" || row.cause === "gone" ? "error" : "blocked"} label={copy.riskCause[row.cause]} />
            <div class="draft-text">
              <span class="draft-name">{copy.draftTitle(title(row).place, title(row).name)}</span>
              <span class="draft-cause">{copy.riskLine(copy.riskCause[row.cause], copy.riskTime(Math.floor((Date.now() - row.since) / 60000)))}</span>
              <Show when={failures()[row.draft.revision]}>{message => <ReservedLine message={message()}>
                <button data-button="quiet" type="button" onClick={() => clear(row.draft.revision)}>{copy.dismissCopyFailure}</button>
              </ReservedLine>}</Show>
            </div>
          </div>
          <div class="draft-actions">
            <Show when={row.cause === "gone" || row.draft.policy === "credential"} fallback={<button data-button="quiet" type="button" onClick={open(row)}>{copy.openDraft}</button>}>
              <button data-button="quiet" type="button" onClick={() => void copyText(row)}>{copy.copyDraft}</button>
            </Show>
            <button data-button="quiet" type="button" onClick={() => drafts.discard(row.draft.revision)}>{copy.discardRow}</button>
          </div>
        </li>}</For>
      </ul>
    </Show>
  </section>;
};
