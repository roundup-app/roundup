/* oxlint-disable anti-slop/no-runtime-typeof -- draftStorage parses the scalar/string-array union; recovery must copy string members verbatim. */
import { useConnectedProject } from "../state/connectedProject";
import { activationSource } from "../keys/registry";
import { registerKeys } from "../keys/registry";
import { IconButton } from "../ui/IconButton";
import { copy } from "../copy";
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import type { Accessor } from "solid-js";
import { KindGlyph } from "../ink/KindGlyph";
import { Icon } from "../ink/Icon";
import { DRAWER_EASING } from "./drawer";
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
  let slideTimer: ReturnType<typeof setTimeout> | undefined;

  const endSlide = () => {
    clearTimeout(slideTimer);
    setDrawerSliding(false);
  };

  createEffect(
    on(() => [props.drawer.content(), props.drawer.source(), props.reducedMotion()] as const, (_action, previous) => {
      const current = ++revision;
      cancelAnimationFrame(settleFrame ?? 0);
      setSettling(previous !== undefined && instant());
      const content = props.drawer.content();

      if (content !== null) setMounted(() => content);
      else if (instant()) setMounted(null);

      if (previous === undefined) return;

      if (instant()) {
        endSlide();
        // Flush the settled layout before restoring the Shelf's own transition policy.
        queueMicrotask(() => {
          if (current !== revision || !panel()?.isConnected) return;
          void panel()!.offsetWidth;
          settleFrame = requestAnimationFrame(() => setSettling(false));
        });

        return;
      }

      setDrawerSliding(true);
      clearTimeout(slideTimer);
      slideTimer = setTimeout(() => {
        endSlide();

        if (!isOpen()) setMounted(null);
      }, 600);
    }),
  );

  onCleanup(() => { revision++; endSlide(); cancelAnimationFrame(settleFrame ?? 0); });

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
        endSlide();

        if (!isOpen()) setMounted(null);
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


/** Recovery never opens an editor or calls the Daemon. Availability is authoritative only
 * for Rail-owned destinations; other owners retain their own reconciliation contract. */
export const DraftRecoveryEntry = () => {
  const connected = useConnectedProject();

  return <button data-button="quiet" type="button" onClick={(event) => connected.drawer.open(() => <DraftRecovery />, activationSource(event))}>{copy.recoverDrafts}</button>;
};

const DraftRecovery = () => {
  const { drafts, project, rail } = useConnectedProject();
  const [selected, select] = createSignal<string | null>(null);
  const [failure, failed] = createSignal<string | null>(null);
  const current = () => drafts.list().filter((draft) => draft.status === "draft").reverse();
  const revisions = createMemo(() => [...current(), ...drafts.list().filter((draft) => draft.status !== "draft").reverse()]);
  const byRevision = createMemo(() => new Map(revisions().map((draft) => [draft.revision, draft])));
  const shown = () => byRevision().get(selected() ?? "") ?? revisions()[0];

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      failed(null);
    } catch (error) {
      failed(copy.copyDraftFailure(error instanceof Error ? error.message : String(error)));
    }
  };

  const availability = (surface: string, object: string) => {
    if (surface !== "orders" && surface !== "rail") return copy.originalUnverified;

    return rail.nodes.some((node) => node.id === object) ? null : copy.originalUnavailable;
  };

  return <section class="draft-recovery" aria-label={copy.unfinishedWork}>
    <h2>{copy.unfinishedWork}</h2>
    <p class="draft-identity">{project.path}</p>
    <Show when={drafts.problem()}>{(problem) => <p role="alert">{copy.draftRetention(project.path, problem().destination?.surface ?? ([...new Set(drafts.list().map((draft) => draft.destination.surface))].join(", ") || copy.allDraftSurfaces), problem().cause)}</p>}</Show>
    <button data-button="quiet" type="button" onClick={() => drafts.retry()}>{copy.storageRetry}</button>
    <Show when={failure()}>{(text) => <p role="alert">{text()}</p>}</Show>
    <Show when={revisions().length} fallback={<p>{copy.noUnfinishedWork}</p>}>
      <ul class="draft-revisions">
        <For each={revisions().map((draft) => draft.revision)}>{(revision) => <Show when={byRevision().get(revision)}>{(draft) => <li>
          <span class="draft-status" data-state={draft().status}><KindGlyph kind={draft().status === "failed" ? "error" : draft().status === "pending" ? "working" : draft().status === "unknown" ? "blocked" : "idle"} label={copy.draftStatus[draft().status]} />{draft().status === "draft" ? copy.currentDraft : copy.earlierRevision} · {copy.draftStatus[draft().status]}</span>
          <button data-button="quiet" type="button" aria-label={`${draft().destination.surface} · ${draft().destination.object} · ${revision}`} aria-pressed={shown()?.revision === revision} onClick={() => select(revision)}>{draft().destination.surface} · {draft().destination.object}</button>
        </li>}</Show>}</For>
      </ul>
      <Show when={shown()}>{(draft) => <section aria-label={draft().revision}>
        <p class="draft-identity">{draft().destination.surface} · {draft().destination.object} · {draft().destination.recipient}</p>
        <Show when={availability(draft().destination.surface, draft().destination.object)}>{(text) => <p data-state="unavailable">{text()}</p>}</Show>
        <For each={Object.keys(draft().value)}>{(field) => <div>
          <h3>{field}</h3>
          <pre class="draft-value">{typeof draft().value[field] === "string" ? String(draft().value[field]) : JSON.stringify(draft().value[field])}</pre>
          <button data-button="quiet" type="button" onClick={() => void copyText(typeof draft().value[field] === "string" ? String(draft().value[field]) : JSON.stringify(draft().value[field]))}>{copy.copyField(field)}</button>
        </div>}</For>
        <button data-button="quiet" type="button" onClick={() => drafts.discard(draft().revision)}>{copy.discardRevision}</button>
      </section>}</Show>
    </Show>
  </section>;
};
