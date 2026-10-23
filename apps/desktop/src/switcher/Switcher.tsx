import { ReservedLine } from "../ink/ReservedLine";
import { createEffect, createMemo, createSignal, on, onCleanup, Show } from "solid-js";
import { debounce } from "@solid-primitives/scheduled";
import * as v from "valibot";
import { copy } from "../copy";
import { KindGlyph } from "../ink/KindGlyph";
import { Combobox } from "../ui/Combobox";
import { useConnectedProject } from "../state/connectedProject";
import { captureActions, registerKeys } from "../keys/registry";
import { leaderChord, SWITCHER_CLOSE, SWITCHER_TAKE } from "../keys/chords";
import { KeyHint } from "../keys/KeyHint";
import { REVEAL_BUBBLE } from "../bubbles/places";
import { entriesOf, matching } from "./entries";
import type { Entry } from "./entries";
import "./styles.css";

const focusTarget = (): void => {
  const target = document.querySelector<HTMLElement>('.thread[data-mode="thread"] .thread-composer textarea:not(:disabled)')
    ?? document.querySelector<HTMLElement>(".pane-screen textarea, .pane-screen [tabindex]");

  target?.focus();
};

/** U529, U530: leader `K` opens a filter field over the centre pane listing every row by name; `⏎` selects the highlighted one as a click does, `⇧⏎` also takes control of an Agent. `onFailure` gets a failed Takeover's message; `onOpen` runs as it opens, so an overlaid Shelf can close and leave no scrim over it. */
export const Switcher = (props: { onFailure: (message: string | null) => void; onOpen: () => void }) => {
  const { rail, takeover, project, drafts } = useConnectedProject();
  const [open, setOpen] = createSignal(false);

  const destination = { surface: "switcher", object: project.path, recipient: null };

  const current = () => drafts.list().filter((draft) => draft.destination.surface === destination.surface
    && draft.destination.object === destination.object && draft.destination.recipient === null).at(-1);

  const retentionProblem = createMemo(() => {
    const problem = drafts.problem();

    return problem && (problem.destination === null || problem.destination.surface === destination.surface) ? problem : null;
  });

  const restored = v.safeParse(v.string(), current()?.value.query);
  const [text, setText] = createSignal(restored.success ? restored.output : "");
  const [copied, setCopied] = createSignal(false);
  const clearCopied = debounce(() => setCopied(false), 2000);
  const [copyFailure, setCopyFailure] = createSignal<string | null>(null);
  const [highlighted, setHighlighted] = createSignal<string | null>(null);
  let restoring = false;
  let savedSelection = current()?.selection ?? null;
  let input: HTMLInputElement | undefined;
  let panel: HTMLElement | undefined;
  let returnTo: Element | null = null;
  let afterOpen: Element | null = null;
  const [opening, setOpening] = createSignal<{ selected: string | null; actions: ReturnType<typeof captureActions> }>({ selected: null, actions: [] });

  const openingSurvives = () => rail.selected() === opening().selected
    && (opening().selected === null || rail.nodes.some((node) => node.id === opening().selected));

  const actions = createMemo(() => openingSurvives() ? opening().actions.filter((action) => action.available()) : []);

  const entries = createMemo(() => entriesOf(rail.nodes, rail.terminals()));

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
    drafts.edit(destination, { query: text() }, selection, "ordinary");
  };

  onCleanup(() => { if (open()) retain(); });

  const restoreQueryFocus = (): void => {
    const selection = input ? [input.selectionStart, input.selectionEnd, input.selectionDirection ?? "none"] as const : null;

    // Let removal of the pressed button finish before returning the native caret.
    queueMicrotask(() => {
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
    if (!problem && previous) { setCopyFailure(null); restoreQueryFocus(); }
  }, { defer: true }));

  const close = (restore: boolean): void => {
    retain();
    setOpen(false);

    if (restore) {
      if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus();

      if (document.activeElement !== returnTo && afterOpen instanceof HTMLElement && afterOpen.isConnected) afterOpen.focus();
    }
  };

  const choose = (entry: Entry, take: boolean): void => {
    close(false);
    props.onFailure(null);

    if (entry.terminal !== undefined) {
      rail.select(entry.terminal.owner === project.path ? null : entry.terminal.owner);
      window.dispatchEvent(new CustomEvent(REVEAL_BUBBLE, { detail: entry.terminal.id }));

      return;
    }

    const node = entry.node!;

    rail.select(node.id);
    focusTarget();

    if (!take || node.kind !== "agent") return;

    void takeover.begin(node.id).then((failure) => {
      if (failure !== null) props.onFailure(failure);
      else focusTarget();
    });
  };

  const chooseValue = (value: string | null, take: boolean): void => {
    const action = opening().actions.find((candidate) => candidate.value === value);

    if (action) {
      if (!openingSurvives() || !action.available()) return;
      close(true);
      action.run();

      return;
    }

    const entry = matching(entries(), text()).find((candidate) => candidate.value === value);

    if (entry) choose(entry, take);
  };

  const chooseHighlighted = (take: boolean): void => chooseValue(highlighted(), take);

  const show = (): void => {
    returnTo = document.activeElement;
    setOpening({ selected: rail.selected(), actions: captureActions(returnTo) });
    props.onOpen();
    afterOpen = document.activeElement;
    savedSelection = current()?.selection ?? null;
    restoring = true;
    setOpen(true);
  };

  registerKeys({ kind: "leader" }, [{ chords: leaderChord("K"), run: show }]);
  registerKeys({ kind: "layer", element: () => panel, active: open, modal: true }, [
    { chords: SWITCHER_CLOSE, run: () => close(true) },
    { chords: SWITCHER_TAKE, run: () => chooseHighlighted(true) },
  ]);

  return (
    <Show when={open()}>
      <section class="switcher" ref={(element) => {
        panel = element;
        queueMicrotask(() => {
          input?.focus();
          // Restore after Ark's initial-focus frame; a dismissed opening must not touch the next field.
          requestAnimationFrame(() => requestAnimationFrame(() => {
            if (!element.isConnected || !restoring || !open()) return;

            const selection = savedSelection;

            if (selection) input?.setSelectionRange(selection.start, selection.end, selection.direction);
            restoring = false;
          }));
        });
      }}>
        <Combobox.Root inputValue={text()} inputRef={(element) => {
          input = element;
          // Ark also reports programmatic clears on Escape/selection; only native edits replace recovery text.
          element.addEventListener("input", () => { restoring = false; setText(element.value); retain(); });
          element.addEventListener("select", retain);
          element.addEventListener("keyup", retain);
          element.addEventListener("pointerup", retain);
          element.addEventListener("blur", (event) => {
            // A recovery action must run before blur can retry storage and remove its target.
            if (event.relatedTarget instanceof Element && event.relatedTarget.closest(".switcher-recovery")) return;
            retain();
          });
        }} items={shown()} group={(item) => item.value.startsWith("action:") ? copy.switcherActions : undefined} highlightedValue={highlighted()} onHighlightChange={setHighlighted} onInput={() => {}}
          onSelect={(value) => chooseValue(value, false)}
          label={copy.switcherLabel} placeholder={copy.switcherPlaceholder} empty={copy.noMatch}
          row={(item) => {
            const action = actions().find((candidate) => candidate.value === item.value);
            const entry = entries().find((candidate) => candidate.value === item.value);

            if (action) return <KeyHint class="switcher-action" labelClass="switcher-name" chipAfter keys={action.keys}>{action.label}</KeyHint>;

            if (!entry) return null;

            return <>
              <Show when={entry.node?.status} fallback={<span class="switcher-mark" />}>{(status) => <KindGlyph kind={status().kind} decorative />}</Show>
              <span class="switcher-name">{entry.label}</span>
              <Show when={entry.owner}><span class="switcher-owner">{entry.owner}</span></Show>
            </>;
          }} />
        <ReservedLine message={copyFailure() ?? (retentionProblem() ? copy.switcherRetentionFailure(retentionProblem()!.operation, project.name) : null)}>

          <Show when={text() !== ""}>
          <button data-button="quiet" ref={restoreFocusOnRemoval} onClick={() => { void navigator.clipboard.writeText(text()).then(() => {
            setCopyFailure(null);
            setCopied(true);
            clearCopied();
          }, () => { setCopied(false); setCopyFailure(copy.switcherCopyFailure); }); }}>{copied() ? copy.queryCopied : copy.copyQuery}</button>
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
      </section>
    </Show>
  );
};
