import { createSignal, For, Show } from "solid-js";
import type { RailNode } from "@contracts/agent/RailNode";
import type { Kind } from "@contracts/Kind";
import { glyphOf, hasInk } from "../ink/glyph";
import { Icon } from "../ink/Icon";
import { KindGlyph } from "../ink/KindGlyph";
import type { ExitState } from "../state/rail";
import { isWorkstream } from "./layout";
import type { NodeRow } from "./layout";
import { isUnprompted, liveLineOf } from "./liveLine";
import { createAgentPads, PadRows, PadsControl } from "./pads/AgentPads";
import { createNear } from "../ink/near";

/** A Kind's mark, or a bare mark for a Workstream, which has no Kind. */
type Mark = { kind: Kind } | { bare: "right" | "down" };

const markOfRow = (row: NodeRow): Mark => {
  if (row.collapsed) return row.collapsed.kind ? { kind: row.collapsed.kind } : { bare: "right" };

  if (row.node.status) return { kind: row.node.status.kind };

  return { bare: "down" };
};

const MarkView = (props: { mark: Mark }) => (
  <Show when={"kind" in props.mark ? props.mark.kind : null} fallback={<span class="glyph" data-tone="grey"><Icon name={"bare" in props.mark ? props.mark.bare : "down"} /></span>}>
    {(kind) => <KindGlyph kind={kind()} />}
  </Show>
);

/** The Workstream's first two letters, uppercase (U172). */
const badgeOf = (name: string): string => [...name.trim()].slice(0, 2).join("").toUpperCase();

const NameField = (props: { node: RailNode; onCommit: (name: string) => void; onCancel: () => void }) => (
  <input
    aria-label="name"
    value={props.node.name}
    ref={(field) =>
      queueMicrotask(() => {
        field.focus();
        field.select();
      })
    }
    onKeyDown={(key) => {
      if (key.key === "Enter") {
        const name = key.currentTarget.value.trim();

        if (name === "") props.onCancel();
        else props.onCommit(name);
      }

      if (key.key === "Escape") props.onCancel();
    }}
    onBlur={props.onCancel}
  />
);


export const RailRowView = (props: {
  row: NodeRow;
  exit: ExitState | null;
  selected: boolean;
  /** Roving tabindex: exactly one row in the Rail is reachable by Tab. */
  tabbable: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onRename: (name: string) => void;
  onStartDoor: () => void;
  doorPending: boolean;
  doorFailure: string | null;
  /** U164: how many of this Agent's Runs are running; shown as `· n` after the name, and hidden at zero. */
  runs?: number;
  /** A drag is under way: live lines are hidden so the rows keep the heights the drag measured. */
  dragging: boolean;
  lifted: boolean;
  /** `1` or `-1` while a drag moves the row into the room it opened, `0` otherwise. */
  shift: number;
  onPointerDown: (press: PointerEvent) => void;
  onOpenMenu: (press: MouseEvent) => void;
}) => {
  const { near, handlers } = createNear(() => props.selected);
  const [editing, setEditing] = createSignal(false);
  const pads = createAgentPads(() => props.row.node);

  const mark = () => markOfRow(props.row);

  const kind = () => {
    const current = mark();

    return "kind" in current ? current.kind : null;
  };

  const inkTone = () => {
    const current = kind();

    return current !== null && hasInk(glyphOf(current)) ? glyphOf(current).tone : undefined;
  };

  const liveLine = () => liveLineOf(props.row.node);
  /** U172: the Door action is whole and never squeezed. */
  const showsAction = () => near() && isWorkstream(props.row.node) && props.exit !== null;
  const showsLiveLine = () => !props.dragging && (near() || isUnprompted(props.row.node));

  return (
    <>
    <div
      class="rail-row"
      role="treeitem"
      aria-level={props.row.depth + 1}
      aria-selected={props.selected}
      aria-expanded={isWorkstream(props.row.node) ? props.row.collapsed === null : undefined}
      data-selected={props.selected}
      data-id={props.row.node.id}
      data-kind={kind() ?? undefined}
      data-lifted={props.lifted}
      data-shift={props.shift}
      tabIndex={props.tabbable ? 0 : -1}
      style={{ "--indent": `calc(${props.row.depth} * var(--rail-step) + var(--rail-inset))` }}
      onClick={props.onSelect}
      onContextMenu={(press) => {
        press.preventDefault();
        props.onOpenMenu(press);
      }}
      onPointerDown={(press) => {
        if (!(press.target instanceof Element) || !press.target.closest("button, input")) props.onPointerDown(press);
      }}
      {...handlers}
    >
      <For each={props.row.trail.slice(0, -1)}>
        {(runs, at) => <Show when={runs}><span class="rail-pass" aria-hidden="true" style={{ "--level": at() }} /></Show>}
      </For>
      <Show when={props.row.depth > 0}>
        <span class="rail-branch" aria-hidden="true" data-last={!props.row.trail.at(-1)} style={{ "--level": props.row.depth - 1 }} />
      </Show>
      <p class="line">
        <Show
          when={isWorkstream(props.row.node)}
          fallback={<MarkView mark={mark()} />}
        >
          <span class="badge" aria-hidden="true">{badgeOf(props.row.node.name)}</span>
        </Show>
        <Show
          when={editing()}
          fallback={
            <span
              class="name"
              classList={{ ink: inkTone() !== undefined }}
              data-tone={inkTone()}
              onDblClick={() => setEditing(true)}
            >
              {props.row.node.name}
              <Show when={(props.runs ?? 0) > 0}>
                <span class="runs" > · {props.runs}</span>
              </Show>
            </span>
          }
        >
          <NameField
            node={props.row.node}
            onCommit={(name) => {
              props.onRename(name);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        </Show>
        <Show when={isWorkstream(props.row.node)}>
          <button data-button="icon"
            class="word"
            aria-label="collapse"
            onClick={(click) => {
              click.stopPropagation();
              props.onToggle();
            }}
          >
            <Icon name={props.row.collapsed ? "right" : "down"} />
          </button>
          <Show when={kind()}>{(current) => <KindGlyph kind={current()} />}</Show>
        </Show>
        <Show when={showsLiveLine() ? liveLine() : null}>
          {(line) => (
            <span class="live light" title={line().label}>
              <span class="live-label">{line().label}</span>
            </span>
          )}
        </Show>
        <Show when={showsAction()}>
          <button data-button="row-action"
            class="word"
            aria-disabled={props.doorPending ? true : undefined}
            onClick={(click) => {
              click.stopPropagation();

              if (!props.doorPending) props.onStartDoor();
            }}
          >
            <Icon name="right" />
            {props.doorFailure ? "retry Door" : "start Door"}
          </button>
        </Show>
        <Show when={isWorkstream(props.row.node)}>
          <Show when={!(showsLiveLine() && liveLine())}>
            <span class="fill" aria-hidden="true" />
          </Show>
          <Show when={props.row.collapsed}>
            {(collapsed) => <span class="light children" title={`${collapsed().children} children`}>{collapsed().children}</span>}
          </Show>
        </Show>
        <Show when={!isWorkstream(props.row.node) && pads.n() > 0 && !(showsLiveLine() && liveLine())}>
          <span class="fill" aria-hidden="true" />
        </Show>
        <PadsControl pads={pads} />
      </p>
    </div>
    <PadRows pads={pads} depth={props.row.depth} />
    </>
  );
};
