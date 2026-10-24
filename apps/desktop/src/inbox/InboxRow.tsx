// fallow-ignore-file duplicate-export -- RowActions belongs to InboxRow; rail/RowIcons has a different directly imported action contract.
import { createEffect, createUniqueId, For, Show } from "solid-js";
import type { Decision } from "@contracts/decision/Decision";
import type { RailNode } from "@contracts/agent/RailNode";
import { copy } from "../copy";
import { questionOf } from "../decisions/AskCard";
import { ReservedLine } from "../ink/ReservedLine";
import { KindGlyph } from "../ink/KindGlyph";
import { Collapsible } from "../ui/Collapsible";
import { quickAnswers } from "./rows";
import type { Quick } from "./rows";

/** An answered Decision's row between its answer and its fold; the Agent's own Kind may already have moved on. */
export type Settled = { decision: string; text: string; phase: "confirm" | "fold" | "gone"; index: number };

export type AgentRow = { key: string; node: RailNode; decision: Decision | undefined; settled: Settled | undefined; arrived: boolean };

export type InboxActions = {
  answer(row: AgentRow, quick: Quick): void;
  retry(row: AgentRow): void;
  open(row: AgentRow): void;
  busy(row: AgentRow): boolean;
  failure(row: AgentRow): string | null;
  folded(row: AgentRow): void;
  dismiss(row: AgentRow): void;
};

const summaryOf = (decision: Decision): string => decision.tool === "ask_user" ? (questionOf(decision.args)?.question ?? decision.tool) : decision.tool;

/** U3770b: one Agent's row. A Decision shows its quick answers in the row; any row opens in place to the Agent's last step and the one action that fits its state. */
export const InboxRow = (props: { row: AgentRow; open: boolean; toggle(): void; actions: InboxActions; head(element: HTMLElement): void }) => {
  const name = createUniqueId();
  const node = () => props.row.node;
  const failure = () => props.actions.failure(props.row);

  const act = (label: string, click: () => void, primary = false) =>
    <button type="button" data-button={primary ? "primary" : "quiet"} class="word" aria-describedby={name} disabled={props.actions.busy(props.row)} onClick={click}>{label}</button>;

  const actions = () => {
    const decision = props.row.decision;

    if (decision) {
      const quick = quickAnswers(decision);

      return quick === null
        ? act(copy.inboxOpenCard, () => props.actions.open(props.row))
        : <For each={quick}>{(each, at) => act(each.label, () => props.actions.answer(props.row, each), at() === 0)}</For>;
    }

    return node().status?.kind === "error"
      ? act(copy.retry, () => props.actions.retry(props.row))
      : act(copy.inboxOpen, () => props.actions.open(props.row));
  };

  return <li class="inbox-item" data-row={props.row.key} data-phase={props.row.settled?.phase} data-arrived={props.row.arrived ? "" : undefined}
    ref={(element: HTMLElement) => createEffect(() => element.toggleAttribute("inert", props.row.settled?.phase === "fold"))}
    onTransitionEnd={(event) => { if (event.target === event.currentTarget && props.row.settled?.phase === "fold") props.actions.folded(props.row); }}>
    <div class="inbox-fold"><div class="inbox-fold-inner">
      <Show when={props.row.settled} fallback={<Collapsible.Root open={props.open} onOpenChange={props.toggle} lazyMount unmountOnExit>
        <div class="inbox-head">
          <Collapsible.Trigger data-button="quiet" class="inbox-row" ref={props.head}>
            <KindGlyph kind={node().status?.kind ?? "idle"} />
            <span id={name} class="inbox-row-name">{node().name}</span>
            <Show when={props.row.decision}>{(decision) => <span class="inbox-row-summary light">{summaryOf(decision())}</span>}</Show>
          </Collapsible.Trigger>
          <div class="inbox-actions">{actions()}</div>
        </div>
        <Collapsible.Content>
          <div class="inbox-body">
            <p class="inbox-step"><span class="light">{copy.inboxLastStep}</span> {node().status?.label}</p>
            <ReservedLine message={failure()}>
              <button type="button" data-button="quiet" class="word" aria-describedby={name} onClick={() => props.actions.dismiss(props.row)}>{copy.inboxDismiss}</button>
            </ReservedLine>
          </div>
        </Collapsible.Content>
      </Collapsible.Root>}>
        {(settled) => <ReservedLine status={settled().text} class="inbox-confirm" tabindex="-1" ref={(element) => queueMicrotask(() => element.focus())} />}
      </Show>
    </div></div>
  </li>;
};
