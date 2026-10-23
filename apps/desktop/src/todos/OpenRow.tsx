import ChevronUp from "lucide-solid/icons/chevron-up";
import type { JSX } from "solid-js";
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { Todo } from "@contracts/todo/Todo";
import { IconButton } from "../ui/IconButton";
import { Tip } from "../ui/Tip";
import { createCutTitle } from "../ui/cutTitle";
import { activationSource } from "../keys/registry";
import type { ActivationSource } from "../keys/registry";
import { createNear } from "../ink/near";
import { copy } from "../copy";
import { Icon } from "../ink/Icon";
import { ShelfRow } from "../ink/ShelfRow";
import { KindGlyph } from "../ink/KindGlyph";
import { ReservedLine } from "../ink/ReservedLine";
import { useConnectedProject } from "../state/connectedProject";
import { HomeMove } from "./HomeMove";
import { TickBox } from "./TickBox";
import { RowButton } from "./RowButton";
import { failureOf } from "./failureOf";
import { homeNameOf } from "./homes";
import { kindOf, openBlockersOf } from "./todoView";

const KIND_LABEL = { idle: copy.idle, blocked: copy.blocked, done: copy.done } as const;

/** U490a: what a list ordering its rows through `ui/Sortable` hands one `OpenRow`. */
export type SortedRow = {
  /** The row's frame, which the Sortable moves. */
  frame: (el: HTMLElement | null) => void;
  /** The open button: the Sortable's handle, and the element that keeps focus after a move. */
  button: (el: HTMLButtonElement | null) => void;
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
  failWith?: (show: (message: string | null) => void) => void;
  /** U3708: the Shelf list's tree place of this row; absent for the Rail's copy. */
  place?: { level: number; parent: number | null };
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
  const near = props.nested ? createNear() : null;
  const [listOpen, setListOpen] = createSignal(false);
  const waitingOn = createMemo(() => openBlockersOf(props.todo, props.known));

  // U3810: every open blocker, including the nesting parent, in id order.
  const waitingLine = createMemo(() => copy.waitsOnTitles(waitingOn().map((blocker) => blocker.title).join(copy.comma)));

  /** U3731: the body's first non-empty line, the row's one quiet line under the title. */
  const bodyLine = createMemo(() => props.todo.body.split("\n").find(line => line.trim() !== "")?.trim() ?? "");

  const [actionFailure, setFailure] = createSignal<string | null>(null);
  const [moveFailure, setMoveFailure] = createSignal<string | null>(null);
  const failure = createMemo(() => moveFailure() ?? actionFailure());

  const toggle = async () => {
    const message = await props.onToggle(props.todo);

    setFailure(message);

    return message;
  };

  // Matches U9's rule: a failure clears on the next click anywhere, not only inside its own row.
  onMount(() => {
    const clear = () => setFailure(null);

    document.addEventListener("click", clear);
    onCleanup(() => document.removeEventListener("click", clear));
  });

  onCleanup(() => {
    props.registerRow?.(props.todo.id, null);
    props.sorted?.frame(null);
    props.sorted?.button(null);
  });

  props.sorted?.fail(setMoveFailure);
  props.failWith?.(setFailure);

  const titleCut = createCutTitle(() => props.todo.title);

  const head = (
    <div class="row-head">
        {props.disclosure}
        <RowButton
          hang={false}
          keysSuspended={props.lifted === true}
          label={copy.todoRow(KIND_LABEL[kindOf(props.todo)], props.todo.id, props.todo.title)}
          pressed={props.pressed}
          selectionActive={props.selectionActive}
          onClick={(event) => props.onPick ? props.onPick(props.todo, event) : props.onOpen(props.todo, activationSource(event))}
          reorderable={props.sorted !== undefined}
          nest={props.nest ? (out) => (out ? props.nest?.out : props.nest?.in) ?? null : undefined}
          onNest={async (run) => setMoveFailure(await run())}
          onKeyDown={(event) => {
            props.onSelectionKey?.(props.todo, event);

            props.sorted?.key(event);
          }}
          ref={(row) => {
            props.registerRow?.(props.todo.id, row);
            props.sorted?.button(row);
          }}
        >
          <span {...titleCut.attrs()} class="shelf-title">{props.todo.title}<span class="todo-strike" aria-hidden="true" data-title={props.todo.title} onAnimationEnd={() => props.onMotionEnd?.()} /></span>
          <Show when={!props.nested && props.todo.estimate_minutes !== null}><span class="todo-row-estimate" data-state="estimate">{copy.todoEstimate(props.todo.estimate_minutes)}</span></Show>
          <Show when={props.current}><span class="todo-now" data-state="">{copy.todoNow}</span></Show>
        </RowButton>
        <Show when={!props.nested && props.sorted}>
          <div class="todo-row-actions" role="group" aria-label={copy.rowActionsFor(props.todo.id)}>
            <Show when={props.sorted}>
              <Show when={props.onAssign}>
                <button data-button="row-action" type="button" class="word light todo-assign" aria-label={copy.assignTodoNumber(props.todo.id)} onClick={(event) => props.onAssign?.(props.todo, event.currentTarget)}>{copy.assign}</button>
              </Show>
              <IconButton aria-label={copy.moveUp} style={props.sorted?.can(-1) ? undefined : { visibility: "hidden" }} onClick={() => props.sorted?.step(-1)}><ChevronUp class="icon" aria-hidden="true" width={16} height={16} stroke-width={1.75} /></IconButton>
              <IconButton aria-label={copy.moveDown} style={props.sorted?.can(1) ? undefined : { visibility: "hidden" }} onClick={() => props.sorted?.step(1)}><Icon name="down" /></IconButton>
            </Show>
          </div>
        </Show>
        <Show when={props.nested}>
          <HomeMove
            id={props.todo.id}
            home={props.todo.home}
            onOpenChange={setListOpen}
            choose={async (home) => {
              const message = await failureOf(() => connected.app.rpc("todo.move", { id: props.todo.id, home }));

              setFailure(message);

              return message;
            }}
          />
        </Show>
      </div>
  );

  return (
    <ShelfRow
      glyph={<>
        <TickBox todo={props.todo} onToggle={toggle} />
        <Show when={!props.todo.done && props.todo.blocked}><KindGlyph kind="blocked" /></Show>
      </>}
      data-id={props.nested ? undefined : props.todo.id}
      data-todo={props.todo.id}
      onAnimationEnd={event => {
        if (props.groupComplete !== undefined && event.target instanceof Element && event.target.matches(".todo-tick-mark path")) props.onMotionEnd?.();
      }}
      data-aggregate-motion={props.aggregateMotion ? "play" : undefined}
      data-group-complete={props.groupComplete === undefined ? undefined : String(props.groupComplete)}
      data-motion={props.motion ? "play" : undefined}
      data-actions-open={near?.near() || listOpen() ? "true" : undefined}
      data-shelf-row={props.nested ? undefined : ""}
      data-selected={props.selected ? "true" : undefined}
      role={props.treeItem?.role}
      aria-level={props.treeItem?.["aria-level"]}
      aria-expanded={props.treeItem?.["aria-expanded"]}
      aria-controls={props.treeItem?.["aria-controls"]}
      aria-owns={props.treeItem?.["aria-owns"]}
      aria-current={props.current && props.treeItem?.role === "treeitem" ? "step" : undefined}
      data-level={props.place?.level}
      style={props.place ? { "padding-inline-start": `calc(var(--space-2) + ${props.place.level - 1} * var(--space-4))` } : undefined}
      class={props.nested ? "todo-row" : "todo-row todo-inset"}
      head={props.nested ? undefined : head}
      {...near?.handlers}
      ref={(frame) => {
        props.sorted?.frame(frame);
      }}
    >
      <Show when={props.nested}>{head}</Show>
      <Show when={bodyLine() !== ""}>
        {/* oxlint-disable-next-line anti-slop/no-tooltip-bypass -- U3731 requires the whole first line as the one-line body's title attribute. */}
        <p class="item-description" data-todo-description title={bodyLine()}>{bodyLine()}</p>
      </Show>
      {props.groupProgress}
      <div class="todo-row-notice"><ReservedLine overlay={props.nested === true} message={failure()} /></div>
      <Show when={props.nested}>
        <p class="shelf-meta" data-todo-meta>
          <Show when={props.nested}><span data-mono>{copy.todoNumberMark}{props.todo.id}</span>{" "}</Show>
          <Show when={props.nested && waitingOn().length > 0}>
            <span data-todo-waits>
              <Tip class="todo-tooltip" text={copy.waitsOnTitles(waitingOn().map((blocker) => blocker.title).join(copy.comma))}>{(trigger) => <span {...trigger()}>{copy.waitsOnWord}</span>}</Tip><span class="todo-blockers"><For each={waitingOn()}>{(blocker, index) => (
                <>
                  <Show when={index() > 0}><span>{copy.comma}</span></Show>
                  <button data-button="quiet" type="button" class="word todo-blocker" data-mono="" onClick={(event) => props.onOpen(blocker, activationSource(event))}>#{blocker.id}</button>
                </>
              )}</For></span>
            </span>
          </Show>
          <Show when={props.nested}>
            {" "}<span data-todo-home>{copy.in}<span data-mono>{homeNameOf(connected.rail.nodes, props.todo.home)}</span></span>
          </Show>
        </p>
      </Show>
      <Show when={!props.nested && !props.todo.done && waitingOn().length > 0}>
        <p class="shelf-meta" data-todo-meta>
          {/* oxlint-disable-next-line anti-slop/no-tooltip-bypass -- U3708 requires the full ellipsized sentence in title; Tip also owns its rendered tooltip. */}
          <Tip class="todo-tooltip" text={waitingLine()}>{(trigger) => <span {...trigger()} data-todo-also-waits title={waitingLine()}><span>{copy.waitsOnWord}</span><span class="todo-blockers"><For each={waitingOn()}>{(blocker, index) => (
            <>
              <Show when={index() > 0}><span>{copy.comma}</span></Show>
              <button data-button="quiet" type="button" class="word todo-blocker" aria-label={copy.openBlocker(blocker.title)} onClick={(event) => props.onOpen(blocker, activationSource(event))}>{blocker.title}</button>
            </>
          )}</For></span></span>}</Tip>
        </p>
      </Show>
    </ShelfRow>
  );
};

