import { useDialog } from "@ark-ui/solid/dialog";
import { captureFocus, queueFocus } from "../keys/focus";
import { writeText } from "../app/clipboard";
import { ReservedLine } from "../ink/ReservedLine";
import { batch, createEffect, createMemo, createSignal, on, onCleanup, Show } from "solid-js";
import { createCopyFeedback } from "../ui/CopyButton";
import * as v from "valibot";
import { copy } from "../copy";
import { KindGlyph } from "../ink/KindGlyph";
import { Combobox } from "../ui/Combobox";
import { trackSurface } from "../ui/openSurfaces";
import { useConnectedProject } from "../state/connectedProject";
import { captureActions, modalOutside, modalOpen, registerKeys } from "../keys/registry";
import { leaderChord, SWITCHER_CLOSE } from "../keys/chords";
import { KeyHint } from "../keys/KeyHint";
import { REVEAL_BUBBLE } from "../bubbles/places";
import { entriesOf, matching } from "./entries";
import type { Entry } from "./entries";
import "./styles.css";

/** U529, U530: leader `K` opens a filter field over the centre pane listing every row by name; `⏎` selects the highlighted one as a click does. `onFailure` gets a failed selection's message; `onOpen` runs as it opens, so an overlaid Shelf can close and leave no scrim over it. */
export const Switcher = (props: { onFailure: (message: string | null) => void; onOpen: () => void }) => {
  const { app, rail, project, drafts } = useConnectedProject();
  const [open, setOpen] = createSignal(false);
  trackSurface(open);

  const destination = { surface: "switcher", object: project.path, recipient: null };

  const current = () => drafts.list().filter((draft) => draft.destination.surface === destination.surface
    && draft.destination.object === destination.object && draft.destination.recipient === null).at(-1);

  const retentionProblem = createMemo(() => {
    const problem = drafts.problem();

    return problem && (problem.destination === null || problem.destination.surface === destination.surface) ? problem : null;
  });

  const restored = v.safeParse(v.string(), current()?.value.query);
  const [text, setText] = createSignal(restored.success ? restored.output : "");
  const feedback = createCopyFeedback();
  const copied = feedback.copied;
  createEffect(on(() => [text(), current()?.revision], feedback.reset));
  const [copyFailure, setCopyFailure] = createSignal<{ revision: string | null } | null>(null);
  const [highlighted, setHighlighted] = createSignal<string | null>(null);
  let restoring = false;
  let savedSelection = current()?.selection ?? null;
  let input: HTMLInputElement | undefined;
  let panel: HTMLElement | undefined;

  let chosenPane = false;
  let chosenTerminal: string | null = null;

  const dialog = useDialog(() => ({
    open: open(), modal: false, trapFocus: true, preventScroll: false,
    restoreFocus: true, closeOnInteractOutside: true,
    "aria-label": copy.switcherLabel,
    initialFocusEl: () => openingFocus.target(() => input),
    finalFocusEl: () => chosenPane
      ? chosenTerminal
        ? document.querySelector<HTMLElement>(`[data-bubble="${chosenTerminal}"] textarea`)
        : document.querySelector<HTMLElement>('.thread[data-mode="thread"] .thread-composer textarea:not(:disabled)')
          ?? document.querySelector<HTMLElement>(".pane-screen textarea, .pane-screen [tabindex]")
      : null,
    // A background layer closing is not a parent dismissal of this independent dialog.
    onRequestDismiss: event => event.preventDefault(),
    onOpenChange: details => { if (!details.open) close(true); },
  }));

  const [opening, setOpening] = createSignal<{ selected: string | null; actions: ReturnType<typeof captureActions> }>({ selected: null, actions: [] });

  const openingSurvives = () => rail.selected() === opening().selected
    && (opening().selected === null || rail.nodes.some((node) => node.id === opening().selected));

  const actions = createMemo(() => openingSurvives() ? opening().actions.filter((action) => action.available()) : []);

  const entries = createMemo(() => entriesOf(rail.nodes, rail.terminals()));

  const byValue = createMemo(() => new Map(entries().map(entry => [entry.value, entry])));

  const shown = createMemo(() => [
    ...matching(entries(), text()),
    ...matching(actions(), text()),
  ]);

  createEffect(() => {
    const list = shown();

    if (!list.some((entry) => entry.value === highlighted())) setHighlighted(list[0]?.value ?? null);
  });

  const retain = (): void => {
    if (!open() || restoring) return;

    const previous = current();

    const selection = input ? {
      start: input.selectionStart ?? 0, end: input.selectionEnd ?? 0, direction: input.selectionDirection ?? "none",
    } : previous?.selection ?? null;

    if ((!previous && text() === "") || (previous?.value.query === text() && JSON.stringify(previous.selection) === JSON.stringify(selection))) return;

    if (previous?.value.query === text()) drafts.setSelection(previous.revision, selection);
    else drafts.edit(destination, { query: text() }, selection, "ordinary");
  };

  onCleanup(() => { if (open()) retain(); });

  const restoreQueryFocus = (): void => {
    const selection = input ? [input.selectionStart, input.selectionEnd, input.selectionDirection ?? "none"] as const : null;

    // Let removal of the pressed button finish before returning the native caret.
    queueFocus(() => {
      if (!open() || !input?.isConnected) return;
      input.focus();

      if (selection) input.setSelectionRange(...selection);
    });
  };

  const restoreFocusOnRemoval = (element: HTMLElement): void => {
    onCleanup(() => {
      // Removing a focused recovery action must leave the query ready for typing.
      if (element.contains(document.activeElement)) restoreQueryFocus();
    });
  };

  createEffect(on(retentionProblem, (problem, previous) => {
    if (!problem && previous) restoreQueryFocus();
  }, { defer: true }));

  createEffect(() => {
    const failure = copyFailure();

    if (failure && failure.revision !== (current()?.revision ?? null)) setCopyFailure(null);
  });

  const copyQuery = (): void => {
    const revision = current()?.revision ?? null;

    const query = text();
    void feedback.run(() => writeText(app, query), () => {
      if (revision === (current()?.revision ?? null)) setCopyFailure(null);
    }, () => {
      if (revision === (current()?.revision ?? null)) setCopyFailure({ revision });
    });
  };

  const close = (restore: boolean): void => {
    retain();
    chosenPane = !restore;
    setOpen(false);
  };

  const choose = (entry: Entry): void => batch(() => {
    chosenTerminal = entry.terminal?.id ?? null;
    close(false);
    props.onFailure(null);

    if (entry.terminal !== undefined) {
      rail.select(entry.terminal.owner === project.path ? null : entry.terminal.owner);
      window.dispatchEvent(new CustomEvent(REVEAL_BUBBLE, { detail: entry.terminal.id }));

      return;
    }

    const node = entry.node!;

    rail.select(node.id);
  });

  const chooseValue = (value: string | null): void => {
    const action = opening().actions.find((candidate) => candidate.value === value);

    if (action) {
      if (!openingSurvives() || !action.available()) return;
      close(true);
      action.run();

      return;
    }

    const entry = matching(entries(), text()).find((candidate) => candidate.value === value);

    if (entry) choose(entry);
  };

  createEffect(() => { if (open() && modalOutside(panel)) close(false); });

  let openingFocus = captureFocus();

  const show = (): void => {
    if (modalOpen()) return;
    chosenPane = false;
    chosenTerminal = null;
    openingFocus = captureFocus(true);
    setOpening({ selected: rail.selected(), actions: captureActions(document.activeElement) });
    props.onOpen();
    savedSelection = current()?.selection ?? null;
    restoring = true;
    setOpen(true);
  };

  registerKeys({ kind: "leader" }, [{ chords: leaderChord("K"), run: show }]);
  registerKeys({ kind: "layer", element: () => panel, active: open, modal: true }, [
    { chords: SWITCHER_CLOSE, run: () => close(true) },
  ]);

  return (
    <Show when={open()}>
      <section {...dialog().getContentProps()} aria-label={copy.switcherLabel} class="switcher" ref={element => { panel = element; }}>
        <Combobox.Root virtualized autoFocus={false} focusScope={() => panel} onDismiss={() => close(false)} initialFocus={openingFocus} inputValue={text()} inputRef={(element) => {
          input = element;
          // Ark also reports programmatic clears on Escape/selection; only native edits replace recovery text.
          element.addEventListener("input", () => { restoring = false; setText(element.value); retain(); });
          element.addEventListener("focus", () => {
            // Ark selects an input after focusing it; restore the retained caret after that selection.
            queueMicrotask(() => {
              if (!restoring || !element.isConnected || document.activeElement !== element) return;
              const selection = savedSelection;

              if (selection) element.setSelectionRange(selection.start, selection.end, selection.direction);
              restoring = false;
            });
          });
          element.addEventListener("select", retain);
          element.addEventListener("keyup", retain);
          element.addEventListener("pointerup", retain);
          element.addEventListener("blur", (event) => {
            // A recovery action must run before blur can retry storage and remove its target.
            if (event.relatedTarget instanceof Element && event.relatedTarget.closest(".switcher .reserved-actions")) return;
            retain();
          });
        }} items={shown()} contentRow={item => !item.value.startsWith("action:")} group={(item) => item.value.startsWith("action:") ? copy.switcherActions : undefined} highlightedValue={highlighted()} onHighlightChange={setHighlighted} onInput={() => {}}
          onSelect={(value) => chooseValue(value)}
          label={copy.switcherLabel} placeholder={copy.switcherPlaceholder} empty={copy.noMatch}
          row={(item) => {
            const action = actions().find((candidate) => candidate.value === item.value);
            const entry = byValue().get(item.value);

            if (action) return <KeyHint class="switcher-action" labelClass="switcher-name" chipAfter keys={action.keys}>{action.label}</KeyHint>;

            if (!entry) return null;

            return <>
              <Show when={entry.node?.status} fallback={<span class="switcher-mark" />}>{(status) => <KindGlyph kind={status().kind} decorative />}</Show>
              <span class="switcher-name">{entry.label}</span>
              <Show when={entry.owner}><span class="switcher-owner">{entry.owner}</span></Show>
            </>;
          }} />
        <ReservedLine message={retentionProblem() ? copy.switcherRetentionFailure(retentionProblem()!.operation, project.name) : null}>
          <Show when={text() !== "" && !copyFailure()}>
            <button data-button="quiet" ref={restoreFocusOnRemoval} onClick={copyQuery}>{copied() ? copy.queryCopied : copy.copyQuery}</button>
          </Show>
          <button data-button="quiet" ref={restoreFocusOnRemoval} onClick={() => { drafts.retry(); }}>{copy.retryStorage}</button>
          <Show when={text() !== ""}>
            <button data-button="quiet" ref={restoreFocusOnRemoval} onClick={() => {
              const draft = current();

              if (draft) drafts.discard(draft.revision);
              setText("");
            }}>{copy.discardQuery}</button>
          </Show>
        </ReservedLine>
        <ReservedLine message={copyFailure() ? copy.switcherCopyFailure : null}>
          <button data-button="quiet" ref={restoreFocusOnRemoval} onClick={copyQuery}>{copied() ? copy.queryCopied : copy.copyQuery}</button>
          <button data-button="quiet" ref={restoreFocusOnRemoval} onClick={() => { setCopyFailure(null); }}>{copy.close}</button>
        </ReservedLine>
      </section>
    </Show>
  );
};
