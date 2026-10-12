import { createSignal, For, Show } from "solid-js";
import type { RailNode } from "@contracts/agent/RailNode";
import type { Kind } from "@contracts/Kind";
import { glyphOf, hasInk } from "../ink/glyph";
import { Icon } from "../ink/Icon";
import { KindGlyph } from "../ink/KindGlyph";
import type { ExitState } from "../state/rail";
import { isWorkstream } from "./layout";
import { Trunks } from "./Trunks";
import type { NodeRow } from "./layout";
import { createAgentPads, PadRows, PadsControl } from "./pads/AgentPads";
import { createNear } from "../ink/near";
import { RowIcons } from "./RowIcons";
import type { RowActions } from "./RowIcons";

/** U403: a folded Workstream shows at most this many Agent Glyphs before its count. */
const FOLDED_GLYPHS = 5;

const NameField = (props: { node: RailNode; onCommit: (name: string) => void; onCancel: () => void }) => (
  <input
    aria-label="Name"
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
  /** U403: the Workstream's `needs-you` Agents, shown as an Ink count at its right when open. */
  needsYou: number;
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
  lifted: boolean;
  /** `1` or `-1` while a drag moves the row into the room it opened, `0` otherwise. */
  shift: number;
  onPointerDown: (press: PointerEvent) => void;
  onOpenMenu: (press: MouseEvent) => void;
  /** U426: the icons of a Workstream or Agent row. */
  actions: RowActions;
}) => {
  const { near, handlers } = createNear(() => props.selected);
  const [editing, setEditing] = createSignal(false);
  const pads = createAgentPads(() => props.row.node);

  const workstream = () => isWorkstream(props.row.node);
  const kind = (): Kind | null => props.row.node.status?.kind ?? null;

  const inkTone = () => {
    const current = kind();

    return current !== null && hasInk(glyphOf(current)) ? glyphOf(current).tone : undefined;
  };

  /** U172: the Door action takes the place of the right side, so it is whole and the right side never squeezes it. */
  const showsAction = () => near() && workstream() && props.exit !== null;

  return (
    <>
    <div
      class="rail-row"
      role="treeitem"
      aria-level={props.row.depth + 1}
      aria-selected={props.selected}
      aria-expanded={workstream() ? props.row.collapsed === null : undefined}
      data-selected={props.selected}
      data-near={near()}
      data-id={props.row.node.id}
      data-kind={kind() ?? undefined}
      data-lifted={props.lifted}
      data-shift={props.shift}
      title={workstream() ? undefined : props.row.node.status?.label}
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
      <Trunks depth={props.row.depth} trail={props.row.trail} stem={props.row.children || pads.shown()} />
      <p class="line">
        <Show
          when={workstream()}
          fallback={<KindGlyph kind={kind() ?? "idle"} />}
        >
          <button data-button="icon"
            class="word rail-chevron"
            aria-label="Collapse"
            onClick={(click) => {
              click.stopPropagation();
              props.onToggle();
            }}
          >
            <Icon name={props.row.collapsed ? "right" : "down"} />
          </button>
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
        <Show when={workstream() ? kind() : null}>{(current) => <KindGlyph kind={current()} />}</Show>
        <span class="fill" aria-hidden="true" />
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
            {props.doorFailure ? "Retry Door" : "Start Door"}
          </button>
        </Show>
        <Show when={workstream() && !showsAction()}>
          <Show
            when={props.row.collapsed}
            fallback={
              <Show when={props.needsYou > 0}>
                <span class="ink-count" data-tone="amber" title={`${props.needsYou} need you`}>
                  <KindGlyph kind="needs-you" decorative /> {props.needsYou}
                </span>
              </Show>
            }
          >
            {(collapsed) => (
              <span class="folded-agents" title={`${collapsed().agents.length} agents`}>
                <For each={collapsed().agents.slice(0, FOLDED_GLYPHS)}>{(each) => <KindGlyph kind={each} />}</For>
                <span class="light">{collapsed().agents.length}</span>
              </span>
            )}
          </Show>
        </Show>
        <PadsControl pads={pads} />
        <RowIcons actions={props.actions} />
      </p>
    </div>
    <PadRows pads={pads} depth={props.row.depth} trail={props.row.trail} children={props.row.children} />
    </>
  );
};
