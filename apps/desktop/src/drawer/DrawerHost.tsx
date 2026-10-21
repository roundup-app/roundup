import { useConnectedProject } from "../state/connectedProject";
import { activationSource } from "../keys/registry";
import { registerKeys } from "../keys/registry";
import { IconButton } from "../ui/IconButton";
import { copy } from "../copy";
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import type { Accessor } from "solid-js";
import { KindGlyph } from "../ink/KindGlyph";
import { Tip } from "../ui/Tip";
import { usePadList } from "../rail/pads/padList";
import { useTodoList } from "../todos/todoList";
import { Icon } from "../ink/Icon";
import { DRAWER_EASING } from "./drawer";
import { createSlideLifetime } from "../ui/slideLifetime";
import { setDrawerSliding } from "./sliding";
import type { DrawerContent, DrawerState } from "./drawer";

/**
 * An overlay: absolutely positioned over the Shelf, at the window's right edge. The centre narrows by the
 * Drawer's width with the same transition (U430), so the Drawer covers none of it (GLOSSARY.md, Drawer).
 */
export const DrawerHost = (props: { drawer: DrawerState; reducedMotion: Accessor<boolean> }) => {
  const [mounted, setMounted] = createSignal<DrawerContent | null>(null);
  const [panel, setPanel] = createSignal<HTMLElement>();
  const isOpen = () => props.drawer.content() !== null;
  const instant = () => props.reducedMotion() || props.drawer.source() === "key";
  const [settling, setSettling] = createSignal(false);
  let settleFrame: number | undefined;
  let revision = 0;
  let heldFocus: HTMLElement | null = null;

  // U40: opening takes the keyboard; closing gives it back to whatever held it, unless focus left the Drawer on its own.
  createEffect(
    on(isOpen, (open, wasOpen) => {
      const host = panel();

      if (open && !wasOpen) {
        heldFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        host?.querySelector<HTMLElement>(".close")?.focus({ preventScroll: true });
      } else if (wasOpen && !open) {
        const stayedInDrawer = host?.contains(document.activeElement) ?? false;
        const toRefocus = heldFocus;

        heldFocus = null;

        if (stayedInDrawer && toRefocus?.isConnected) toRefocus.focus({ preventScroll: true });
      }
    }),
  );

  // U430: the centre moves for as long as the slide runs; with no motion there is no slide.
  const lifetime = createSlideLifetime();

  createEffect(() => setDrawerSliding(lifetime.sliding()));
  createEffect(on(lifetime.exiting, (exiting, was) => { if (was && !exiting && !isOpen()) setMounted(null); }));

  createEffect(
    on(() => [props.drawer.content(), props.drawer.source(), props.reducedMotion()] as const, (_action, previous) => {
      const current = ++revision;
      cancelAnimationFrame(settleFrame ?? 0);
      setSettling(previous !== undefined && instant());
      const content = props.drawer.content();

      if (content !== null) setMounted(() => content);
      else if (instant()) setMounted(null);

      if (previous === undefined) return;

      lifetime.retarget(isOpen(), !instant());

      if (!instant()) return;

      // Flush the settled layout before restoring the Shelf's own transition policy.
      queueMicrotask(() => {
        if (current !== revision || !panel()?.isConnected) return;
        void panel()!.offsetWidth;
        settleFrame = requestAnimationFrame(() => setSettling(false));
      });
    }),
  );

  onCleanup(() => { revision++; cancelAnimationFrame(settleFrame ?? 0); });

  registerKeys({ kind: "layer", element: panel, active: isOpen, modal: false }, [{
    chords: ["Escape"],
    when: (press) => !(press.target instanceof Element && press.target.closest('input, textarea, [contenteditable], .xterm, .pane-screen')),
    run: () => props.drawer.close("key"),
  }]);

  return (
    <aside
      class="drawer"
      aria-label={copy.drawer}
      inert={!isOpen()}
      data-open={isOpen()}
      data-motion={instant() ? "none" : "slide"}
      data-settling={settling()}
      ref={setPanel}
      style={{
        position: "absolute",
        top: "0",
        right: "0",
        bottom: "0",
        transform: isOpen() ? "translateX(0)" : "translateX(100%)",
        transition: instant() ? "none" : `transform var(--duration-drawer) ${DRAWER_EASING}`,
      }}
      onTransitionEnd={(event) => {
        if (event.target !== event.currentTarget || (event.propertyName && event.propertyName !== "transform")) return;
        lifetime.settle();
      }}
    >
      <IconButton class="close" aria-label={copy.close} onClick={(event) => props.drawer.close(activationSource(event))}>
        <Icon name="x" />
      </IconButton>
      <Show when={mounted()} keyed>
        {(content) => content()}
      </Show>
    </aside>
  );
};


/** Recovery never opens an editor or sends mutations. Availability uses the original Rail or Pad identity; other owners retain their own reconciliation contract. */
export const DraftRecoveryEntry = () => {
  const connected = useConnectedProject();

  const visibleDecision = createMemo(() => connected.decisions.of(connected.rail.selected()));

  const currentDecisions = createMemo(() => new Map(connected.drafts.list()
    .filter((draft) => draft.destination.surface === "decisions" && draft.status === "draft")
    .map((draft) => [draft.destination.object, draft.revision])));

  const records = () => connected.drafts.recoverable().filter((draft) => {
    if (draft.destination.surface.startsWith("rail-")) return false;

    const visible = visibleDecision();

    return !(draft.destination.surface === "decisions" && draft.status === "draft"
      && visible?.answerable && visible.id === draft.value.decision
      && draft.revision === currentDecisions().get(draft.destination.object)
      && connected.decisions.availability({ daemon: String(draft.value.daemon), agent: String(draft.value.agent), attempt: String(draft.value.attempt), decision: String(draft.value.decision) }) === "available");
  });

  const problem = () => connected.drafts.problem()?.destination?.surface.startsWith("rail-") ? null : connected.drafts.problem();

  return <Show when={records().length || problem()}>
    <Show when={problem()}>{failure => <p class="draft-recovery draft-identity" role="status" aria-label={copy.draftIdentity(copy.projectName, connected.project.path)}>{copy.draftRetention(connected.project.path, failure().destination ? copy.draftSurface(failure().destination!.surface) : copy.allDraftSurfaces, failure().cause)}</p>}</Show>
    <button class="draft-entry" data-button="quiet" type="button" aria-label={copy.recoverDrafts} onClick={(event) => connected.drawer.open(() => <DraftRecovery />, activationSource(event))}>
      <span class="overview-tile"><Icon name="edit" /></span><span>{copy.recoverDrafts}</span>
      <Show when={records().length}><span data-state="draft">{records().length}</span></Show>
    </button>
  </Show>;
};

const DraftRecovery = () => {
  const { drafts, project, rail, daemonExit, decisions } = useConnectedProject();
  const pads = usePadList();
  const todos = useTodoList();
  const [selected, select] = createSignal<string | null>(null);
  const [failure, failed] = createSignal<string | null>(null);
  const records = createMemo(() => drafts.recoverable().filter((draft) => !draft.destination.surface.startsWith("rail-")));

  // External recovery can retain two unsubmitted revisions for one destination.
  // Only its newest unsubmitted revision is current; inspection never promotes another.
  const current = createMemo(() => new Set(new Map(records().filter((draft) => draft.status === "draft")
    .map((draft) => [JSON.stringify([draft.destination.surface, draft.destination.object, draft.destination.recipient]), draft.revision])).values()));

  const revisions = createMemo(() => [...records()].reverse().sort((a, b) => Number(current().has(b.revision)) - Number(current().has(a.revision))));
  const byRevision = createMemo(() => new Map(revisions().map((draft) => [draft.revision, draft])));
  const shown = () => byRevision().get(selected() ?? "") ?? revisions()[0];

  const fieldText = (draft: ReturnType<typeof drafts.list>[number], field: string): string => {
    const value = draft.value[field];

    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- draftStorage parsed this scalar/string-array union; string members must be copied verbatim.
    return typeof value === "string" ? value : JSON.stringify(value);
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      failed(null);
    } catch (error) {
      failed(copy.copyDraftFailure(error instanceof Error ? error.message : String(error)));
    }
  };

  // Pad owners capture value.originalName (captured name), source and base verbatim; destination.object
  // is the captured public incarnation, never a name resolved from the current list. Creation
  // drafts omit value.originalName until a Pad exists, so recovery cannot mistake them for deleted Pads.
  // Display names may change independently; project.path comes only from this shared authority.
  const availability = (draft: ReturnType<typeof drafts.list>[number]) => {
    const { surface, object } = draft.destination;

    if (surface === "pads") {
      if (!draft.value.originalName || !pads.loaded() || pads.failure()) return copy.originalUnverified;

      return pads.pads().some((pad) => pad.incarnation === object) ? null : copy.originalUnavailable;
    }

    if (surface === "orders" || surface === "rail") {
      return rail.nodes.some((node) => node.id === object) ? null : copy.originalUnavailable;
    }

    const state = drafts.availability(draft, { rail, daemonExit, decisions });

    return state === "available" ? null : state === "unavailable" ? copy.originalUnavailable : copy.originalUnverified;
  };

  const identity = (draft: ReturnType<typeof drafts.list>[number]) => {
    const { surface, object } = draft.destination;
    const node = rail.nodes.find((node) => node.id === (surface === "terminal_selection" ? draft.value.source : object));

    const name = surface === "pads" ? draft.value.originalName
      : surface === "todos" ? todos.all().find((todo) => String(todo.id) === object)?.title
      : surface === "header" && object === project.path ? project.name : node?.name;

    return copy.draftIdentity(copy.draftSurface(surface === "rail" && node ? node.kind : surface), name ? String(name) : copy.originalDraftObject);
  };

  const fields = (draft: ReturnType<typeof drafts.list>[number]) => draft.destination.surface === "terminal_selection"
    ? ["note", "excerpt", "command", "cwd", "exit"].filter((field) => draft.value[field] !== null && draft.value[field] !== undefined)
    : Object.keys(draft.value);

  return <section class="draft-recovery" aria-label={copy.unfinishedWork}>
    <h2>{copy.unfinishedWork}</h2>
    <p class="draft-identity">{project.path}</p>
    <Show when={drafts.problem()?.destination?.surface.startsWith("rail-") ? null : drafts.problem()}>{(problem) => <div role="alert"><p>{copy.draftRetention(project.path, problem().destination ? copy.draftSurface(problem().destination!.surface) : (copy.draftSurfaces([...new Set(drafts.recoverable().map((draft) => copy.draftSurface(draft.destination.surface)))]) || copy.allDraftSurfaces), problem().cause)}</p><button data-button="quiet" type="button" onClick={() => drafts.retry()}>{copy.storageRetry}</button></div>}</Show>
    <Show when={failure()}>{(text) => <p role="alert">{text()}</p>}</Show>
    <Show when={revisions().length} fallback={<p>{copy.noUnfinishedWork}</p>}>
      <ul class="draft-revisions">
        <For each={revisions().map((draft) => draft.revision)}>{(revision) => <Show when={byRevision().get(revision)}>{(draft) => <li data-current={current().has(revision)} data-revision={revision}>
          <div class="draft-destination"><Show when={draft().status === "draft"}><Icon name="edit" /></Show><Tip text={copy.draftIdentity(identity(draft()), draft().destination.object)}>{(trigger) => <span {...trigger()} class="draft-name">{identity(draft())} <span class="draft-object">{draft().destination.object}</span></span>}</Tip>
          <span class="draft-status" data-state={draft().status} data-kind={draft().status === "failed" ? "error" : undefined}><KindGlyph kind={draft().status === "failed" ? "error" : draft().status === "pending" ? "working" : "blocked"} label={copy.draftStatus[draft().status]} />{current().has(revision) ? copy.currentDraft : copy.draftStatus[draft().status]}</span></div>
          <button data-button="quiet" type="button" aria-label={copy.draftIdentity(copy.inspectDraft, copy.draftSurface(draft().destination.surface), draft().destination.object, revision)} aria-pressed={shown()?.revision === revision} onClick={() => select(revision)}>{copy.inspectDraft}</button>
        </li>}</Show>}</For>
      </ul>
      <Show when={shown()}>{(draft) => <section class="draft-detail" aria-label={draft().revision}>
        <h3>{copy.inspectedRevision(identity(draft()), current().has(draft().revision) ? copy.currentDraft : copy.draftStatus[draft().status])}</h3>
        <p class="draft-identity">{copy.draftIdentity(draft().destination.object, draft().destination.recipient ?? copy.noDraftRecipient)}</p>
        <Show when={availability(draft())}>{(text) => <p role="status" data-state={text() === copy.originalUnavailable ? "unavailable" : "unverified"}>{text()}</p>}</Show>
        <Show when={draft().policy === "credential"}><p>{copy.credentialDraftMemoryOnly}</p></Show>
        <For each={fields(draft())}>{(field) => <div>
          <h3>{copy.draftField(field)}</h3>
          <Show when={draft().policy === "ordinary"}><pre class="draft-value">{fieldText(draft(), field)}</pre></Show>

        </div>}</For>
        <div class="draft-actions">
        <For each={fields(draft())}>{(field) => <button data-button="quiet" type="button" onClick={() => void copyText(fieldText(draft(), field))}>{copy.copyField(field === "excerpt" ? copy.draftField(field) : copy.draftField(field).toLowerCase())}</button>}</For>
        <button data-button="quiet" type="button" onClick={() => drafts.discard(draft().revision)}>{copy.discardRevision}</button></div>
      </section>}</Show>
    </Show>
  </section>;
};
