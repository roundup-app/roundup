import type { Actor } from "@contracts/Actor";
import { currentOwner, type RailState } from "../state/rail";
import { captureFocus } from "../keys/focus";
import type { App } from "../app/seam";
import { shelfKeyScope } from "./keys";
import { copy } from "./copy";
import { createContext, createEffect, createMemo, createSignal, For, on, onCleanup, Show, useContext } from "solid-js";
import type { Accessor, JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { ReservedLine } from "../ink/ReservedLine";
import { registerKeys } from "../keys/registry";
import { IconButton } from "../ui/IconButton";
import { Icon } from "../ink/Icon";

export const ShelfActions = createContext<{ mount: Accessor<HTMLDivElement | undefined>; open: Accessor<boolean>; /** U3730: the scope line, where the tab's one add control sits. */ scope: Accessor<HTMLElement | undefined> }>();

type Target<Id> = { id: Id; label: string; owner?: Actor | null | undefined };

type Question<Id> = { kind: "question" | "pending"; targets: readonly Target<Id>[]; done: boolean };

/** U3787a: dispatch the frozen set immediately; retain failed rows after readback. */
export const createBulkDelete = <Id,>(props: {
  app: Pick<App, "ask">;
  rail?: Pick<RailState, "nodes" | "exitOf">;
  selected: Accessor<readonly Id[]>;
  targets: Accessor<readonly Target<Id>[]>;
  done?: Accessor<readonly Target<Id>[]>;
  context: Accessor<string>;
  noun: "Todos" | "Pads";
  replace: (ids: readonly Id[]) => void;
  clear: () => void;
  cancelSelection: () => void;
  afterRemoval?: () => () => HTMLElement | null;
  remove: (ids: readonly Id[]) => Promise<readonly { id: Id; message: string }[]>;
  blocked: Accessor<boolean>;
  reload: () => Promise<string | null>;
  reveal?: () => void;
}) => {
  const host = useContext(ShelfActions);
  const [question, setQuestion] = createSignal<Question<Id> | null>(null);
  const [failures, setFailures] = createSignal<readonly { target: Target<Id>; message: string }[]>([]);
  const [readFailure, setReadFailure] = createSignal<string | null>(null);
  let readback: (() => Promise<void>) | undefined;
  let revision = 0;
  let deleteButton: HTMLButtonElement | undefined;
  let returnTo: HTMLElement | null = null;
  let nextFocus: () => HTMLElement | null = () => null;

  const reset = () => {
    revision += 1;
    setQuestion(null);
    setFailures([]);
    setReadFailure(null);
    props.clear();
  };

  createEffect(on(() => `${props.context()}:${host?.open()}`, reset, { defer: true }));
  onCleanup(() => { revision += 1; });
  createEffect(on(props.targets, targets => {
    setFailures(current => current.filter(({ target }) => targets.some(row => row.id === target.id)));
  }));

  let returnRegion: HTMLElement | null = null;

  const ask = (done = false, focused?: Id) => {
    if (question() || props.blocked()) return;
    const targets = done ? props.done?.() ?? [] : props.targets().filter((target) => focused === undefined ? props.selected().includes(target.id) : target.id === focused);

    if (targets.length === 0) return;
    const unique = [...new Map(targets.map((target) => [target.id, { ...target }])).values()];
    returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    returnRegion = returnTo?.closest<HTMLElement>("[data-history-region]") ?? null;
    nextFocus = props.afterRemoval?.() ?? (() => null);
    setQuestion({ kind: "question", targets: unique, done });
    void confirm();
  };

  /** The opener while it lives, else a Shelf control that does: a deleted row's button is gone. */
  const focusAfter = (): HTMLElement | null => {
    const next = nextFocus();

    if (next) return next;

    if (returnTo?.isConnected) return returnTo;

    if (returnRegion?.isConnected) {
      const firstRow = returnRegion.querySelector<HTMLElement>(".todo-row-button, .pad-name");

      if (firstRow) return firstRow;

      if (!returnRegion.hasAttribute("tabindex")) returnRegion.tabIndex = -1;

      return returnRegion;
    }

    if (deleteButton?.isConnected) return deleteButton;

    return document.querySelector<HTMLElement>('.shelf button:not([disabled]), .shelf [tabindex="0"], .shelf input:not([disabled])')
      ?? document.querySelector<HTMLElement>('.shelf-tabs [role="tab"][aria-selected="true"]');
  };

  const confirm = async () => {
    const kept = question();

    if (kept?.kind !== "question") return;
    const focus = captureFocus();
    const mine = revision;
    const targets = kept.targets;
    setQuestion({ ...kept, kind: "pending", targets });
    setFailures(current => current.filter(({ target }) => !targets.some(row => row.id === target.id)));
    const result = await props.remove(targets.map(target => target.id));

    const failed = result.flatMap(item => {
      const target = targets.find(target => target.id === item.id);

      return target ? [{ target, message: item.message }] : [];
    });

    // A lost response can follow a committed delete; readback precedes retry.
    readback = async () => {
      const message = await props.reload();

      if (mine !== revision) return;
      setReadFailure(message);

      if (message !== null) return;

      if (kept.done && failed.length > 0) props.reveal?.();
      const remaining = [...failures(), ...failed].filter(({ target }) => props.targets().some((row) => row.id === target.id));
      props.replace(remaining.map(({ target }) => target.id));
      setFailures(remaining);
      setQuestion(null);
      readback = undefined;
      queueMicrotask(() => focus(() => focusAfter()?.focus()));
    };

    await readback();
  };

  const key = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;

    if (event.key === "Escape" && (question() || props.selected().length > 0)) {
      event.preventDefault();
      event.stopPropagation();

      if (!question()) { props.cancelSelection(); setFailures([]); }
    } else if (event.key === "Backspace" && !event.repeat && props.selected().length > 0) {
      event.preventDefault();
      event.stopPropagation();
      ask();
    }
  };

  registerKeys(shelfKeyScope, [
    { chords: ["Escape"], when: event => props.selected().length > 0 && !(event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable], .todo-blocker")), run: key },
    { chords: ["Backspace"], when: event => props.selected().length > 0 && event.target instanceof Element && event.target.closest(".shelf-bulk") !== null, run: key },
  ]);

  registerKeys({ kind: "region", element: () => host ? document.querySelector<HTMLElement>(".shelf-tabs") ?? undefined : undefined }, [{
    chords: ["Escape"],
    when: () => props.selected().length > 0,
    run: key,
  }]);

  createEffect(() => {
    if (props.selected().length === 0 && question() === null) setFailures([]);
  });

  const owners = createMemo(() => {
    const kept = question();

    const targets = kept?.kind === "pending" ? kept.targets : props.targets().filter((target) =>
      kept ? kept.targets.some((row) => row.id === target.id) : props.selected().includes(target.id));

    const resolved = targets.flatMap(target => {
      const owner = props.rail ? currentOwner(props.rail, target.owner) : undefined;

      return owner ? [owner] : [];
    });

    return [...new Map(resolved.map(owner => [owner.id, owner])).values()];
  });

  const labelOf = (target: Target<Id>) => `${target.label}${props.noun === "Todos" ? ` #${String(target.id)}` : ""}`;

  const shown = () => (readFailure() === null ? failures() : []);
  const failureText = (failure: { target: Target<Id>; message: string }) => `${copy.couldNotDelete} ${labelOf(failure.target)}${copy.colon}${failure.message}`;

  const clearButton = (failure: { target: Target<Id>; message: string }) => (
    <IconButton aria-label={`${copy.clear} ${labelOf(failure.target)}`} onClick={() => setFailures(current => current.filter(other => other.target.id !== failure.target.id))}><Icon name="x" /></IconButton>
  );

  const bar = () => (
    <Show when={props.selected().length > 1 || failures().length > 0 || question()?.kind === "pending" || readFailure() !== null}>
      <div class="shelf-bulk" role="group" aria-label={copy.shelfDeletion}>
        <Show when={props.selected().length > 0}>
          <div class="shelf-bulk-line" hidden={question()?.kind === "question"}>
            <span>{props.selected().length}{copy.selected}</span>
            <button data-button="quiet" type="button" ref={(button) => { deleteButton = button; }} disabled={question()?.kind === "pending"} onClick={() => ask()}>{copy.deleteWord}{props.selected().length}</button>
            <button data-button="quiet" type="button" disabled={question()?.kind === "pending"} onClick={() => { props.cancelSelection(); setFailures([]); }}>{copy.cancel}</button>
          </div>
        </Show>
        <Show when={owners().length > 0}>
          <p>{copy.ownedBy}{owners().map(owner => owner.name).join(copy.comma)}</p>
        </Show>
        <Show when={owners().some(owner => owner.live)}>
          <p>{copy.agentsMayStillBeWritingDeletingDoesNot(owners().filter(owner => owner.live).map(owner => owner.name).join(copy.comma))}</p>
        </Show>
        <ReservedLine data-deletion-pending={question()?.kind === "pending"} aria-busy={question()?.kind === "pending"} status={question()?.kind === "pending" ? copy.draftStatus.pending : null} message={readFailure() ?? (shown().length > 0 ? failureText(shown()[0]!) : null)}>
          <Show when={readFailure() !== null} fallback={shown().length > 0 ? clearButton(shown()[0]!) : null}>
            <button data-button="quiet" type="button" onClick={() => void readback?.()}>{copy.refresh}</button>
          </Show>
        </ReservedLine>
        <For each={shown().slice(1)}>{failure => (
          <ReservedLine message={failureText(failure)}>{clearButton(failure)}</ReservedLine>
        )}</For>
      </div>
    </Show>
  );

  const Bar = (): JSX.Element => host ? <Show when={host.mount()}>{(mount) => <Portal mount={mount()}>{bar()}</Portal>}</Show> : bar();

  return { ask, key, Bar, pending: () => question()?.kind === "pending" };
};
