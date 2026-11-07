import { createMemo, For, onCleanup, Show } from "solid-js";
import { createRowCollection, rowKey } from "../ui/RowCollection";
import { copy } from "./copy";
import { queueFocus } from "../keys/focus";
import { createCut } from "../ink/Tip";
import { ReservedLine } from "../ink/ReservedLine";
import { KindGlyph, LABELS } from "../ink/KindGlyph";
import { errorCause } from "../ink/FailureLine";
import { useConnectedProject } from "../state/connectedProject";
import { attentionOrder } from "../rail/attention";
import { descendantsOf, resolvedWorkstream, siblingsOf } from "../rail/layout";
import { Tip } from "../ui/Tip";
import type { RailNode } from "@contracts/agent/RailNode";
import { ToolCallLine } from "./ToolCallLine";

export const ProjectOverview = () => {
  const { rail, hasView, hideView } = useConnectedProject();
  const attention = createMemo(() => attentionOrder(rail.nodes, rail.dismissed));
  const workstreams = createMemo(() => siblingsOf(rail.nodes, null).flatMap((node) => [node, ...descendantsOf(rail.nodes, node.id)]).filter((node) => node.kind === "workstream"));
  const under = (id: string | null) => attention().filter((node) => node.id !== id && resolvedWorkstream(rail.nodes, node.id) === id);

  const emptyWorkstreams = () => hasView("workstreams") && workstreams().length === 0;

  const called = (id: string | null) => rail.nodes.filter((node) => node.tool_call !== undefined && resolvedWorkstream(rail.nodes, node.id) === id);

  const heads = new Map<string, HTMLElement>();

  const entries = () => hasView("workstreams")
    ? [...workstreams().flatMap(node => [node, ...under(node.id)]), ...attention().filter(node => node.kind !== "workstream" && resolvedWorkstream(rail.nodes, node.id) === null)]
    : attention();

  const content = createRowCollection(() => entries().filter(node => {
    const head = heads.get(node.id);

    return head && !head.closest("[hidden], [inert], [disabled], [aria-disabled=true]");
  }).map(node => ({ value: node.id, label: node.name })), { onActivate: id => rail.select(id) });

  const entry = (node: RailNode, waiting = false) => <OverviewEntry node={node} waiting={waiting} status={true} select={() => rail.select(node.id)} selected={content.selection.isSelected(node.id)} head={element => {
    heads.set(node.id, element); content.register(element, node.id);
    onCleanup(() => { if (heads.get(node.id) === element) heads.delete(node.id); });
  }} />;

  return <section class="project-overview" aria-label={copy.projectOverview} on:click={{ capture: true, handleEvent: content.click }} on:keydown={{ capture: true, handleEvent: rowKey }}>
    <Show when={hasView("workstreams")}><div class="made-heading"><h2 class="overview-heading">{copy.workstreams}</h2><button type="button" data-button="quiet" onClick={() => { hideView("workstreams"); queueFocus(() => document.querySelector<HTMLElement>(".ask-input")?.focus()); }}>{copy.closeView(copy.workstreams)}</button></div></Show>
    <Show when={attention().length === 0}><p class="overview-quiet">{emptyWorkstreams() ? copy.noWorkstreamYet : copy.projectAttention(0)}</p></Show>
    <ul class="overview-list">
      <For each={hasView("workstreams") ? workstreams() : []}>{(node) => <li>
        {entry(node)}
        <Show when={under(node.id).length > 0}><ul class="overview-attention">
          <For each={under(node.id)}>{(agent) => <li>{entry(agent, true)}</li>}</For>
        </ul></Show>
        <Show when={called(node.id).length > 0}><ul class="overview-calls">
          <For each={called(node.id)}>{(agent) => <li><ToolCallLine name={agent.name} call={agent.tool_call!} /></li>}</For>
        </ul></Show>
      </li>}</For>
      <For each={hasView("workstreams") ? attention().filter(node => node.kind !== "workstream" && resolvedWorkstream(rail.nodes, node.id) === null) : attention()}>{(node) => <li>{entry(node, true)}</li>}</For>
      <For each={hasView("workstreams") ? called(null) : []}>{(agent) => <li><ToolCallLine name={agent.name} call={agent.tool_call!} /></li>}</For>
    </ul>
  </section>;
};

const OverviewEntry = (props: { node: RailNode; status: boolean; waiting: boolean; select: () => void; selected: boolean; head: (element: HTMLButtonElement) => void }) => {
  const status = () => props.status ? props.node.status : null;
  const [cutRef, cut] = createCut();

  return <Tip text={props.node.name} disabled={!cut()}>{(trigger, focus) => {
    const tip = trigger();

    return <button {...focus} ref={props.head} data-row-selected={props.selected} onClick={props.select} type="button" class="overview-entry row-wash"
      data-overview-item={props.node.id + ":" + props.node.attempt + ":" + props.node.status_revision} aria-label={[props.node.name, status() ? LABELS[status()!.kind] : ""].filter(Boolean).join(" ")}
      data-feedback="ink" data-button="quiet">
      <Tip text={status() ? LABELS[status()!.kind] : ""} disabled={!status()}>{(trigger) =>
        <span {...trigger()} class={props.waiting ? "overview-state ink" : "overview-state"} data-state={status()?.kind} data-tone={status()?.kind === "error" ? "red" : undefined}>
          <Show when={status()}>{(status) => <KindGlyph kind={status().kind} />}</Show>
        </span>
      }</Tip>
      <span {...tip} ref={cutRef} class={props.waiting ? "overview-name ink" : "overview-name"}>{props.node.name}</span>
      <Show when={errorCause(status(), false)}>{cause => <ReservedLine status={cause()} />}</Show>
    </button>;
  }}</Tip>;
};
