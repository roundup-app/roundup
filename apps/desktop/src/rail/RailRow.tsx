import { copy } from "../copy";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { Tooltip } from "../ui";
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
    aria-label={copy.name}
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


/** U2228a: a hover on a button or input of the row belongs to that control's own tooltip, never the row's. */
const ignoringControls = <T extends { onPointerMove?: unknown; onPointerLeave?: unknown }>(props: T): T => {
  // SAFETY: the row's Ark tooltip trigger props carry these as pointer-event handlers when present.
  const move = props.onPointerMove as ((event: PointerEvent) => void) | undefined;
  // SAFETY: same trigger props; onPointerLeave is the handler that closes the row's tooltip.
  const leave = props.onPointerLeave as ((event: PointerEvent) => void) | undefined;

  return {
    ...props,
    onPointerMove: (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest("button, input")) move?.(event);
      else leave?.(event);
    },
  };
};

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

  // U2228a: a name cut to `…` in the layout it has now (hovered, focused or selected included) shows in full in the row's Tooltip.
  const [cut, setCut] = createSignal(false);
  let nameBox: HTMLSpanElement | undefined;
  const measure = () => setCut(!!nameBox && nameBox.scrollWidth > nameBox.clientWidth);

  createEffect(() => {
    props.row.node.name;
    props.runs;
    near();
    props.selected;
    editing();
    queueMicrotask(measure);
  });

  createEffect(() => {
    const row = nameBox?.closest(".rail-row");

    if (!nameBox || !row || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(measure);
    observer.observe(row);
    observer.observe(nameBox);
    onCleanup(() => observer.disconnect());
  });

  const kind = (): Kind | null => props.row.node.status?.kind ?? null;

  const inkTone = () => {
    const current = kind();

    return current !== null && hasInk(glyphOf(current)) ? glyphOf(current).tone : undefined;
  };

  /** U172: the Door action takes the place of the right side, so it is whole and the right side never squeezes it. */
  const showsAction = () => near() && workstream() && props.exit !== null;

  return (
    <>
    <Tooltip.Root disabled={!cut()} positioning={{ placement: "bottom-start" }}>
    <Tooltip.Trigger
      asChild={(trigger) => (
    <div
      {...ignoringControls(trigger({
        onClick: props.onSelect,
        onPointerDown: (press: PointerEvent) => {
          if (!(press.target instanceof Element) || !press.target.closest("button, input")) props.onPointerDown(press);
        },
        ...handlers,
      }))}
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
      onContextMenu={(press) => {
        press.preventDefault();
        props.onOpenMenu(press);
      }}
    >
      <Trunks depth={props.row.depth} trail={props.row.trail} stem={props.row.children || pads.shown()} />
      <p class="line">
        <Show
          when={workstream()}
          fallback={<KindGlyph kind={kind() ?? "idle"} />}
        >
          <button data-button="icon"
            class="word rail-chevron"
            aria-label={copy.collapse}
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
              ref={nameBox}
              classList={{ ink: inkTone() !== undefined }}
              data-tone={inkTone()}
              onDblClick={() => setEditing(true)}
            >
              {props.row.node.name}
              <Show when={(props.runs ?? 0) > 0}>
                <span class="runs" >{copy.separator}{props.runs}</span>
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
        <span class="row-tail">
          <Show when={workstream() ? kind() : null}>{(current) => <KindGlyph kind={current()} />}</Show>
          <RowIcons actions={props.actions}>
            <Show when={showsAction()}>
              <button data-button="icon"
                class="door-action"
                aria-label={props.doorFailure ? copy.retryDoor : copy.startDoor}
                title={props.doorFailure ? copy.retryDoor : copy.startDoor}
                aria-disabled={props.doorPending ? true : undefined}
                onClick={(click) => {
                  click.stopPropagation();

                  if (!props.doorPending) props.onStartDoor();
                }}
              >
                <Icon name="play" />
                <span class="door-action-label">{props.doorFailure ? copy.retryDoor : copy.startDoor}</span>
              </button>
            </Show>
          </RowIcons>
        </span>
        <span class="fill" aria-hidden="true" />
        <Show when={workstream() && !showsAction()}>
          <Show
            when={props.row.collapsed}
            fallback={
              <Show when={props.needsYou > 0}>
                <span class="ink-count" data-tone="amber" title={copy.needYou(props.needsYou)}>
                  <KindGlyph kind="needs-you" decorative /> {props.needsYou}
                </span>
              </Show>
            }
          >
            {(collapsed) => (
              <span class="folded-agents" title={copy.agents(collapsed().agents.length)}>
                <For each={collapsed().agents.slice(0, FOLDED_GLYPHS)}>{(each) => <KindGlyph kind={each} />}</For>
                <span class="light">{collapsed().agents.length}</span>
              </span>
            )}
          </Show>
        </Show>
        <PadsControl pads={pads} />
      </p>
    </div>
      )}
    />
    <Show when={cut()}>
      <Portal>
        <Tooltip.Positioner>
          <Tooltip.Content class="rail-name-tip">{props.row.node.name}</Tooltip.Content>
        </Tooltip.Positioner>
      </Portal>
    </Show>
    </Tooltip.Root>
    <PadRows pads={pads} depth={props.row.depth} trail={props.row.trail} children={props.row.children} />
    </>
  );
};
