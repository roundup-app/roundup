// fallow-ignore-file duplicate-export -- RowActions belongs to InboxRow; rail/RowIcons has a different directly imported action contract.
import { createUniqueId, Show } from "solid-js";
import type { RailNode } from "@contracts/agent/RailNode";
import type { TerminalInfo } from "@contracts/terminal/TerminalInfo";
import { nameOf } from "../bubbles/places";
import { statusText } from "../terminal/programStatus";
import { copy } from "./copy";
import { ReservedLine } from "../ink/ReservedLine";
import { KindGlyph } from "../ink/KindGlyph";
import { FailureLine } from "../ink/FailureLine";
import { Collapsible } from "../ui/Collapsible";

/** One entry: an Agent's `node`, or a Terminal whose program reported (PS11.1). */
export type AgentRow = { key: string; arrived: boolean } & ({ node: RailNode; terminal?: undefined } | { terminal: TerminalInfo; node?: undefined });

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
  const terminal = () => props.row.terminal;
  const status = () => node()?.status ?? terminal()?.status ?? null;
  const entryName = () => node()?.name ?? (terminal() ? nameOf(terminal()!) : "");
  const item = () => node() ? node()!.id + ":" + node()!.attempt + ":" + node()!.status_revision : `terminal:${terminal()!.id}:${terminal()!.status?.since}`;
  const step = () => terminal() ? statusText(terminal()!.status!) : node()!.status?.label;
  const failure = () => props.actions.failure(props.row);

  const act = (label: string, click: () => void, primary = false) =>
    <button type="button" data-button={primary ? "primary" : "quiet"} class="word" aria-describedby={name} disabled={props.actions.busy(props.row)} onClick={click}>{label}</button>;

  const actions = () => node()?.status?.kind === "error" && node()!.can_resume
    ? act(copy.retry, () => props.actions.retry(props.row))
    : act(copy.inboxOpen, () => props.actions.open(props.row));

  return <li class="inbox-item" data-row={props.row.key} data-arrived={props.row.arrived ? "" : undefined}>
    <Collapsible.Root open={props.open} onOpenChange={props.toggle} lazyMount unmountOnExit>
      <div class="inbox-head">
        <Collapsible.Trigger data-button="quiet" class="inbox-row" data-selected={props.selected} data-overview-item={item()} ref={props.head}>
          <KindGlyph kind={status()?.kind ?? "idle"} />
          <span id={name} class="inbox-row-name">{entryName()}</span>
        </Collapsible.Trigger>
        <div class="inbox-actions">{actions()}</div>
      </div>
      <FailureLine status={node()?.status} class="inbox-failure" />
      <Collapsible.Content>
        <div class="inbox-body">
          <p class="inbox-step"><Show when={node()}><span class="light">{copy.inboxLastStep}</span> </Show>{step()}</p>
          <ReservedLine message={failure()}>
            <button type="button" data-button="quiet" class="word" aria-describedby={name} onClick={() => props.actions.dismiss(props.row)}>{copy.inboxDismiss}</button>
          </ReservedLine>
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  </li>;
};
