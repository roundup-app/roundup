// fallow-ignore-file duplicate-export -- RowActions belongs to InboxRow; rail/RowIcons has a different directly imported action contract.
import { createUniqueId, Show } from "solid-js";
import type { RailNode } from "@contracts/agent/RailNode";
import { copy } from "../copy";
import { ReservedLine } from "../ink/ReservedLine";
import { KindGlyph } from "../ink/KindGlyph";
import { Collapsible } from "../ui/Collapsible";

export type AgentRow = { key: string; node: RailNode; arrived: boolean };

export type RowActions = {
  retry(row: AgentRow): void;
  open(row: AgentRow): void;
  busy(row: AgentRow): boolean;
  failure(row: AgentRow): string | null;
  dismiss(row: AgentRow): void;
};

/** U3770b: one Agent's row. Any row opens in place to the Agent's last step and the one action that fits its state. */
export const InboxRow = (props: { row: AgentRow; open: boolean; selected: boolean; toggle(): void; actions: RowActions; head(element: HTMLElement): void }) => {
  const name = createUniqueId();
  const node = () => props.row.node;
  const failure = () => props.actions.failure(props.row);

  const act = (label: string, click: () => void, primary = false) =>
    <button type="button" data-button={primary ? "primary" : "quiet"} class="word" aria-describedby={name} disabled={props.actions.busy(props.row)} onClick={click}>{label}</button>;

  const actions = () => node().status?.kind === "error"
    ? act(copy.retry, () => props.actions.retry(props.row))
    : act(copy.inboxOpen, () => props.actions.open(props.row));

  return <li class="inbox-item" data-row={props.row.key} data-arrived={props.row.arrived ? "" : undefined}>
    <Collapsible.Root open={props.open} onOpenChange={props.toggle} lazyMount unmountOnExit>
      <div class="inbox-head">
        <Collapsible.Trigger data-button="quiet" class="inbox-row" data-selected={props.selected} data-overview-item={node().id + ":" + node().attempt + ":" + node().status_revision} ref={props.head}>
          <KindGlyph kind={node().status?.kind ?? "idle"} />
          <span id={name} class="inbox-row-name">{node().name}</span>
        </Collapsible.Trigger>
        <div class="inbox-actions">{actions()}</div>
      </div>
      <Collapsible.Content>
        <div class="inbox-body">
          <p class="inbox-step"><span class="light">{copy.inboxLastStep}</span> {node().status?.label}</p>
          <Show when={failure()}><ReservedLine message={failure()}>
            <button type="button" data-button="quiet" class="word" aria-describedby={name} onClick={() => props.actions.dismiss(props.row)}>{copy.inboxDismiss}</button>
          </ReservedLine></Show>
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  </li>;
};
