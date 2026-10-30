import { Age } from "../shelf/Age";
import { OpenButton } from "../ink/OpenButton";
import { Sortable } from "../ui/sortable";
import { createCopyFeedback } from "../ui/CopyButton";
import { NameField } from "../ui/Editable";
import type { Accessor, JSX } from "solid-js";
import { createEffect, createMemo, createSignal, on, onCleanup, Show, untrack } from "solid-js";
import type { Todo } from "@contracts/todo/Todo";
import { createCutTitle } from "../ui/cutTitle";
import type { ActivationSource } from "../keys/registry";
import { copy } from "../copy";
import { ShelfRow } from "../ink/ShelfRow";
import { KindGlyph } from "../ink/KindGlyph";
import { ReservedLine } from "../ink/ReservedLine";
import { useConnectedProject } from "../state/connectedProject";

import { TickBox } from "./TickBox";
import { RowButton } from "./RowButton";
import { doesClearTodoFailure } from "./failureOf";
import { kindOf } from "./todoView";

const KIND_LABEL = { idle: copy.idle, blocked: copy.blocked, done: copy.done } as const;

/** U490a: what a list ordering its rows through `ui/Sortable` hands one `OpenRow`. */
export type SortedRow = {
  /** The row's frame, which the Sortable moves. */
  frame: (el: HTMLElement | null) => void;
  /** The name button, retaining neighbour-move and selection focus. */
  button: (el: HTMLButtonElement | null) => void;
  handle: (el: HTMLButtonElement | null) => void;
  /** Where a failed move shows. */
  fail: (show: (message: string | null) => void) => void;
  /** `⌥↑` and `⌥↓`. */
  key: (event: KeyboardEvent) => void;
  step: (by: -1 | 1) => void;
  /** Whether a sibling sits in that direction; the arrow for a direction with none is hidden. */
  can: (by: -1 | 1) => boolean;
};

/** One open Todo as U15 draws it, with U35's `complete` and `waits on`; `nested` is the Rail's copy (U60), which leaves `data-id` to the Agent rows. */
export const OpenRow = (props: {
  nested?: boolean;
  copyWith?: (feedback: ReturnType<typeof createCopyFeedback>) => () => void;
  lifted?: boolean;
  pressed?: boolean;
  selectionActive?: boolean;
  onPick?: (todo: Todo, event: MouseEvent) => void;
  onSelectionKey?: (todo: Todo, event: KeyboardEvent) => void;
  /** U153: the row whose Drawer is open. */
  selected?: boolean;
  todo: Todo;
  known: ReadonlyMap<number, Todo>;
  onOpen: (todo: Todo, source: ActivationSource) => void;
  onToggle: (todo: Todo) => Promise<string | null>;
  registerRow?: (id: number, row: HTMLButtonElement | null) => void;
  /** U490a: a row ordered through `ui/Sortable` instead. */
  sorted?: SortedRow;
  /** U3720: opens the owner list for this row. */
  onAssign?: (todo: Todo, anchor: HTMLElement) => void;
  /** U3720: a failure the owner list reports for this row. */
  failWith?: (show: (message: string | null) => void, message: Accessor<string | null>, rename: () => void) => void;
  /** U3708: the Shelf list's tree place of this row; absent for the Rail's copy. */
  place?: { level: number; parent: number | null };
  connections?: JSX.Element;
  /** U3708: `ui/TreeView`'s `treeitem` props for this row (its role and level). */
  treeItem?: JSX.HTMLAttributes<HTMLElement>;
  /** U3770: a finish is playing on this row. */
  motion?: boolean;
  /** U3808: latest eligible recorded Hand-off for this Agent. */
  current?: boolean;
  disclosure?: JSX.Element;
  groupProgress?: JSX.Element;
  groupComplete?: boolean | undefined;
  aggregateMotion?: boolean;
  /** U3770: this row's own effects ended. */
  onMotionEnd?: () => void;
  /** U3709: what Tab and ⇧Tab do on this row; `null` where the key is not this row's. */
  nest?: { in: (() => Promise<string | null>) | null; out: (() => Promise<string | null>) | null };
}) => {
  const connected = useConnectedProject();
  const copied = createCopyFeedback();
  const unregisterCopy = props.copyWith?.(copied);
  onCleanup(() => unregisterCopy?.());
  // The frame and button must unregister through the same closures that registered them.
  const sorted = untrack(() => props.sorted);
  const [editing, setEditing] = createSignal(false);
  const [picked, setPicked] = createSignal(false);
  let rowButton: HTMLButtonElement | undefined;

  const closeName = (restore = true) => { setEditing(false);

 if (restore) queueMicrotask(() => rowButton?.focus()); };

  const [failedAction, setFailedAction] = createSignal<string | null>(null);
  const [actionFailure, setFailure] = createSignal<string | null>(null);
  const [moveFailure, setMoveFailure] = createSignal<string | null>(null);
  const failure = createMemo(() => moveFailure() ?? actionFailure());

  const toggle = async () => {
    const id = props.todo.id;
    const message = await props.onToggle(props.todo);

    if (id !== props.todo.id) return message;

    if (message === null) clearFailure();
    else { setFailedAction(props.todo.done ? copy.reopen : copy.complete); setFailure(message); }

    return message;
  };

  const clearFailure = () => { setFailure(null); setMoveFailure(null); };

  createEffect(on(() => props.todo.id, clearFailure));
  onCleanup(connected.events.subscribe(event => {
    if (doesClearTodoFailure(event, props.todo.id)) clearFailure();
  }));

  onCleanup(() => {
    props.registerRow?.(props.todo.id, null);
    sorted?.frame(null);
    sorted?.button(null);
    sorted?.handle(null);
  });

  const reportMove = (message: string | null) => { if (message === null) clearFailure(); else setMoveFailure(message); };

  const reportAction = (message: string | null) => { if (message === null) clearFailure(); else setFailure(message); };

  sorted?.fail(reportMove);
  props.failWith?.(reportAction, failure, () => setEditing(true));

  const titleCut = createCutTitle(() => props.todo.title);

  const head = (
    <div class="row-head">
        {props.disclosure}
        <Show when={!editing()} fallback={<NameField object={`todo:${props.todo.id}`} name={props.todo.title}
          version={async () => String((await connected.app.rpc("todo.getHistory", { id: props.todo.id })).changes.at(-1)?.seq ?? 0)}
          commit={async (text, _base, version) => { if (version === null) throw new Error(copy.originalUnverified); await connected.app.rpc("todo.update", { id: props.todo.id, title: text, body: null, expected_change: Number(version) }); }}
          close={closeName} fail={message => { setFailedAction(copy.rename); setFailure(message); }} />}>
        <RowButton
          hang={false}
          keysSuspended={props.lifted === true}
          label={copy.todoRow(KIND_LABEL[kindOf(props.todo)], props.todo.id, props.todo.title)}
          pressed={props.pressed ?? picked()}
          selectionActive={props.selectionActive}
          onClick={(event) => { if (props.onPick) props.onPick(props.todo, event); else { setPicked(true); rowButton?.focus(); } }}
          onRename={() => setEditing(true)}
          onOpen={() => props.onOpen(props.todo, "key")}
          reorderable={sorted !== undefined}
          nest={props.nest ? (out) => (out ? props.nest?.out : props.nest?.in) ?? null : undefined}
          onNest={async (run) => reportMove(await run())}
          onKeyDown={(event) => {
            props.onSelectionKey?.(props.todo, event);

            sorted?.key(event);
          }}
          ref={(row) => {
            rowButton = row;
            props.registerRow?.(props.todo.id, row);
            sorted?.button(row);
          }}
        >
          <span {...titleCut.attrs()} class="shelf-title">{copied.copied() ? copy.copied : props.todo.title}<span class="todo-strike" aria-hidden="true" data-title={props.todo.title} onAnimationEnd={() => props.onMotionEnd?.()} /></span>
        </RowButton>
        </Show>
        <span class="row-controls">
          <Show when={props.groupComplete === undefined}><TickBox motion={props.motion === true} todo={props.todo} onToggle={toggle} /></Show>
        </span>
        <Age updatedAt={props.todo.updated_at} />
        <OpenButton name={props.todo.title} onOpen={() => props.onOpen(props.todo, "pointer")} />
        <Show when={sorted}>{order => <Sortable.Handle label={copy.moveTodoRow(props.todo.id, props.todo.title)} tooltip={copy.moveItem(props.todo.title)} ref={el => order().handle(el ?? null)} />}</Show>
      </div>
  );

  return (
    <ShelfRow
      glyph={<span><KindGlyph kind={failure() !== null ? "error" : props.todo.blocked ? "blocked" : props.todo.done ? "done" : "idle"} /></span>}
      data-id={props.nested ? undefined : props.todo.id}
      data-todo={props.todo.id}
      data-requested={connected.padsTab() === "todos" && props.todo.creator.kind === "agent" && props.todo.creator.id === connected.padsOwner() ? "true" : undefined}
      onClick={event => {
        if (editing() || props.lifted || !(event.target instanceof Element) || event.target.closest("button, input, [role=checkbox]")) return;

        if (props.onPick) props.onPick(props.todo, event);
        else { setPicked(true); rowButton?.focus(); }
      }}
      onDblClick={event => {
        if (!editing() && !props.lifted && event.target instanceof Element && !event.target.closest("button, input, [role=checkbox]")) props.onOpen(props.todo, "pointer");
      }}
      data-lifted={props.lifted ? "true" : undefined}
      onAnimationEnd={event => {
        if (props.groupComplete !== undefined && event.target instanceof Element && event.target.matches(".todo-tick-mark path")) props.onMotionEnd?.();
      }}
      data-aggregate-motion={props.aggregateMotion ? "play" : undefined}
      data-group-complete={props.groupComplete === undefined ? undefined : String(props.groupComplete)}
      data-motion={props.motion ? "play" : undefined}
      data-shelf-row={props.nested ? undefined : ""}
      data-editing={editing()}
      data-selected={props.pressed || picked() || props.selected ? "true" : undefined}
      role={props.treeItem?.role}
      aria-level={props.treeItem?.["aria-level"]}
      aria-expanded={props.treeItem?.["aria-expanded"]}
      aria-controls={props.treeItem?.["aria-controls"]}
      aria-owns={props.treeItem?.["aria-owns"]}
      aria-current={props.current && props.treeItem?.role === "treeitem" ? "step" : undefined}
      data-level={props.place?.level}
      style={props.place ? { "--todo-depth": props.place.level - 1 } : undefined}
      class={props.nested ? "todo-row" : "todo-row todo-inset"}
      head={props.nested ? undefined : head}
      ref={(frame) => {
        sorted?.frame(frame);
      }}
    >
      <Show when={props.nested}>{head}</Show>
      {props.connections}
      <div class="todo-group-status">{props.groupProgress}</div>
      <div class="todo-row-notice"><ReservedLine overlay message={failure()} content={failedAction() && actionFailure() && !moveFailure() ? <>{copy.failed(failedAction()!, "")}<span>{failure()}</span></> : undefined} /></div>
    </ShelfRow>
  );
};
