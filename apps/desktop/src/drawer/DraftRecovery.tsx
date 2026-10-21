import { useConnectedProject } from "../state/connectedProject";
import { activationSource } from "../keys/registry";
import { copy } from "../copy";
import { createSignal, For, Show } from "solid-js";
import { KindGlyph } from "../ink/KindGlyph";
import { usePadList } from "../rail/pads/padList";
import { useTodoList } from "../todos/todoList";
import { Icon } from "../ink/Icon";
import { PadDrawer } from "../pads/PadDrawer";
import { todoEditor } from "./editors";
import { typedText, useUnfinishedWork } from "./unfinishedWork";

/** Recovery lists only work at risk (U3021a) and never sends mutations. */
export const DraftRecoveryEntry = () => {
  const connected = useConnectedProject();
  const work = useUnfinishedWork();

  const problem = () => connected.drafts.problem()?.destination?.surface.startsWith("rail-") ? null : connected.drafts.problem();

  return <Show when={work.rows().length || problem()}>
    <Show when={problem()}>{failure => <p class="draft-recovery" role="status">{copy.draftProblem(failure().cause)}</p>}</Show>
    <button class="draft-entry" data-button="quiet" type="button" aria-label={copy.recoverDrafts} onClick={(event) => connected.drawer.open(() => <DraftRecovery />, activationSource(event))}>
      <span class="overview-tile"><Icon name="edit" /></span><span>{copy.recoverDrafts}</span>
      <Show when={work.rows().length}><span data-state="draft">{work.rows().length}</span></Show>
    </button>
  </Show>;
};

const DraftRecovery = () => {
  const { drafts, project, rail, drawer } = useConnectedProject();
  const pads = usePadList();
  const todos = useTodoList();
  const work = useUnfinishedWork();
  const [failure, failed] = createSignal<string | null>(null);

  type Row = ReturnType<typeof work.rows>[number];

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      failed(null);
    } catch (error) {
      failed(copy.copyDraftFailure(error instanceof Error ? error.message : String(error)));
    }
  };

  const node = (row: Row) => rail.nodes.find((candidate) => candidate.id === (row.draft.destination.surface === "terminal_selection" ? row.draft.value.source : row.draft.destination.object));

  const title = (row: Row) => {
    const { surface, object } = row.draft.destination;

    const name = surface === "pads" ? row.draft.value.originalName
      : surface === "todos" ? todos.all().find((todo) => String(todo.id) === object)?.title
      : surface === "header" && object === project.path ? project.name : node(row)?.name;

    return { place: copy.draftSurface(surface === "rail" && node(row) ? node(row)!.kind : surface), name: String(name ?? typedText(row.draft)[0]).trim().split("\n")[0] };
  };

  const open = (row: Row) => {
    const { surface, object } = row.draft.destination;

    if (surface === "pads" && row.draft.value.originalName) {
      return () => drawer.open(() => <PadDrawer name={String(row.draft.value.originalName)} pads={pads.pads} recovery={{ project: project.path, revision: row.draft.revision, list: pads }} onLateFailure={() => {}} />, "key");
    }

    if (surface === "todos" && todos.all().some((todo) => String(todo.id) === object)) {
      const editor = todoEditor.get();

      return editor ? () => drawer.open(() => editor({ id: Number(object), todos, recovery: { project: project.path, revision: row.draft.revision } }), "key") : null;
    }

    const target = node(row);

    return target ? () => rail.select(target.id) : null;
  };

  return <section class="draft-recovery" aria-label={copy.unfinishedWork}>
    <h2>{copy.unfinishedWork}</h2>
    <Show when={drafts.problem()?.destination?.surface.startsWith("rail-") ? null : drafts.problem()}>{(problem) => <div role="alert"><p>{copy.draftProblem(problem().cause)}</p><button data-button="quiet" type="button" onClick={() => drafts.retry()}>{copy.tryAgain}</button></div>}</Show>
    <Show when={failure()}>{(text) => <p role="alert">{text()}</p>}</Show>
    <Show when={work.rows().length} fallback={<p>{copy.noUnfinishedWork}</p>}>
      <ul class="draft-revisions">
        <For each={work.rows()}>{(row) => <li data-revision={row.draft.revision}>
          <div class="draft-destination">
            <KindGlyph kind={row.cause === "failed" || row.cause === "gone" ? "error" : "blocked"} label={copy.riskCause[row.cause]} />
            <span class="draft-text">
              <span class="draft-name">{title(row).place} "{title(row).name}"</span>
              <span class="draft-cause">{copy.riskCause[row.cause]} · {copy.riskTime(Math.floor((Date.now() - row.since) / 60000))}</span>
            </span>
          </div>
          <div class="draft-actions">
            <Show when={row.cause === "gone"} fallback={<Show when={open(row)}>{(go) => <button data-button="quiet" type="button" onClick={() => go()()}>{copy.openDraft}</button>}</Show>}>
              <button data-button="quiet" type="button" onClick={() => void copyText(typedText(row.draft).join("\n"))}>{copy.copyDraft}</button>
            </Show>
            <button data-button="quiet" type="button" onClick={() => drafts.discard(row.draft.revision)}>{copy.discardRow}</button>
          </div>
        </li>}</For>
      </ul>
    </Show>
  </section>;
};
