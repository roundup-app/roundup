import { createMemo, createSignal, For, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { Dialog } from "../ui/Dialog";
import { CopyButton } from "../ui/CopyButton";
import type { App } from "../app/seam";
import { copy } from "../sharedCopy";

/** The current draft first, then the other revisions newest first (`scenarios/unfinished-input.md`). */
export const recoveryOrder = <T extends { revision: string }>(records: readonly T[], current: T | undefined): T[] =>
  [...records].reverse().sort((a, b) => Number(b.revision === current?.revision) - Number(a.revision === current?.revision));

/**
 * U511a, U2773e: the dialog that recovers an unfinished name edit, for the Terminal tab and the Project tab alike.
 * The surface supplies what differs: identity, notice, the reserved lines and the revision labels.
 */
export const NameDraftRecovery = <T extends { revision: string }>(props: {
  class: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalFocusEl?: (() => HTMLElement | null) | undefined;
  panel: (element: HTMLDivElement) => void;
  identity: string;
  records: readonly T[];
  current: T | undefined;
  /** The reserved lines above the revisions: a copy failure and the retention message with its retry. */
  lines: JSX.Element;
  /** The label of one revision's button, when more than one revision is kept. */
  label: (draft: T, index: number, current: boolean) => string;
  /** What shows in place of the buttons when one revision is kept. */
  solo?: ((draft: T, current: boolean) => JSX.Element) | undefined;
  /** The line above the shown revision's value (the base-conflict note, the draft status). */
  detail?: ((draft: T) => JSX.Element) | undefined;
  notice: (draft: T) => JSX.Element;
  value: (draft: T) => string;
  app: Pick<App, "writeClipboardText">;
  onCopyFailure: (draft: T, error: Error) => void;
  onCopySuccess: (draft: T) => void;
  onDiscard: (draft: T) => void;
}) => {
  const [inspected, inspect] = createSignal<string>();
  const shown = createMemo(() => props.records.find(draft => draft.revision === inspected()) ?? props.current ?? props.records.at(-1));
  const isCurrent = (draft: T) => draft.revision === props.current?.revision;

  return <Dialog.Root instant open={props.open} onOpenChange={details => props.onOpenChange(details.open)} finalFocusEl={props.finalFocusEl}>
    <Portal><Dialog.Positioner asChild={positioner => <aside {...positioner({})} />}><Dialog.Content class={`draft-recovery ${props.class}`} ref={props.panel}>
      <Dialog.Title asChild={title => <h2 {...title({})}>{copy.unfinishedWork}</h2>} />
      <Dialog.Description class="draft-identity">{props.identity}</Dialog.Description>
      {props.lines}
      <Show when={props.records.length > 1} fallback={<Show when={props.solo ? props.records.at(-1) : undefined}>{draft => props.solo!(draft(), isCurrent(draft()))}</Show>}>
        <For each={recoveryOrder(props.records, props.current)}>{(draft, index) => <button type="button" data-button="quiet" aria-pressed={shown()?.revision === draft.revision} onClick={() => inspect(draft.revision)}>{props.label(draft, index(), isCurrent(draft))}</button>}</For>
      </Show>
      <Show when={shown()}>{draft => <>
        {props.detail?.(draft())}
        {props.notice(draft())}
        <pre class="draft-value">{props.value(draft())}</pre>
      </>}</Show>
      <div class="draft-actions">
        <Show when={shown()}>{draft => <>
          <CopyButton app={props.app} identity={draft().revision} text={props.value(draft())} onSuccess={() => props.onCopySuccess(draft())} onFailure={error => props.onCopyFailure(draft(), error)}>{copy.copyProjectName}</CopyButton>
          <button type="button" data-button="quiet" onClick={() => props.onDiscard(draft())}>{copy.discardRevision}</button>
        </>}</Show>
        <Dialog.CloseTrigger data-button="quiet">{copy.close}</Dialog.CloseTrigger>
      </div>
    </Dialog.Content></Dialog.Positioner></Portal>
  </Dialog.Root>;
};

