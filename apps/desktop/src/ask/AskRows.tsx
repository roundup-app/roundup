import { Dynamic } from "solid-js/web";
import { findTargets } from "../terminal/links";
import { focusPane } from "../bubbles/focus";
import { createMemo, createSignal, For, Show } from "solid-js";
import { TargetText } from "../terminal/TargetText";
import type { AskPart } from "@contracts/ask/AskPart";
import type { Target } from "@contracts/ask/Target";
import { copy } from "./copy";
import { createCut } from "../ink/Tip";
import { DISMISS_ONLY, ReservedLine } from "../ink/ReservedLine";
import { KindGlyph, LABELS } from "../ink/KindGlyph";
import { FailureLine, shownKind } from "../ink/FailureLine";
import { useConnectedProject } from "../state/connectedProject";
import type { AskEntry } from "../state/asks";
import { registerKeys, type KeyScope } from "../keys/registry";
import { Tip, type TriggerProps } from "../ui/Tip";
import { Select } from "../ui/Select";

/** The Workstream a part went to, once it has one. */
const workstreamOf = (part: AskPart): string | null =>
  part.placement.kind === "routed" ? part.placement.workstream : part.placement.kind === "new" ? (part.placement.workstream ?? null) : null;

const STATE_WORDS: Record<AskPart["state"], string> = {
  placing: copy.askPlacing,
  waiting: copy.askWaiting,
  queued: copy.askQueued,
  typed: copy.askSent,
  failed: copy.askFailed,
  dropped: copy.askDropped,
};

const isUnresolved = (asks: ReturnType<typeof useConnectedProject>["asks"], entry: AskEntry, index: number, part: AskPart) =>
  part.state !== "dropped" && !asks.acknowledged(entry, index);

/** U504: the Ask parts that stay in the change list: not dropped and not yet acknowledged by a view of their Terminal. */
export const unresolvedParts = (asks: ReturnType<typeof useConnectedProject>["asks"]) =>
  asks.entries().flatMap(entry => entry.parts.flatMap((part, index) => isUnresolved(asks, entry, index, part) ? [{ entry, part, index }] : []));

/** U505, U506: one row for each part of each Ask, newest first. */
export const AskRows = (props: { onOpened: () => void; keys: KeyScope }) => {
  const { asks, rail } = useConnectedProject();

  const parts = createMemo(() => {
    const shown = new Set<string>();

    return asks.entries().flatMap(entry => entry.parts.map((part, index) => {
      const id = workstreamOf(part);
      const live = part.state === "typed" && id !== null && !shown.has(id);

      if (live) shown.add(id!);

      return { entry, part, index, live };
    }));
  });

  const nameOf = (id: string): string => rail.nodes.find((node) => node.id === id)?.name ?? id;

  const where = (part: AskPart): string => {
    const placement = part.placement;

    if (placement.kind === "routed") return nameOf(placement.workstream);

    if (placement.kind === "new") return placement.workstream === undefined ? placement.title : nameOf(placement.workstream);

    return placement.question;
  };

  const open = (id: string): void => {
    rail.select(id);
    props.onOpened();
    focusPane();
  };

  const live = () => parts().filter(row => isUnresolved(asks, row.entry, row.index, row.part));

  const rows = (items: ReturnType<typeof parts>) => <ul class="ask-rows" aria-label={copy.askRows}>
    <For each={items}>{({ entry, part, index, live }) => <AskRow live={live} keys={props.keys} entry={entry} part={part} index={index} where={where(part)} workstream={workstreamOf(part)} open={open} />}</For>
  </ul>;

  return <Show when={live().length > 0}><div class="ask-content">
    <Show when={live().length > 0}><section class="ask-parts" aria-label={copy.askRows}>

      {rows(live())}
    </section></Show>
  </div></Show>;
};

const AskRow = (props: { live: boolean; keys: KeyScope; entry: AskEntry; part: AskPart; index: number; where: string; workstream: string | null; open: (id: string) => void }) => {
  const { asks, rail, project } = useConnectedProject();

  let button: HTMLButtonElement | undefined;
  const [isLinkFocused, setIsLinkFocused] = createSignal(false);
  const [text, isTextCut] = createCut(() => props.part.text);
  const [name, isNameCut] = createCut(() => props.where);
  const tooltip = () => [isTextCut() ? props.part.text : null, isNameCut() ? props.where : null].filter(Boolean).join("\n");

  const arrows = [{
    chords: ["ArrowUp", "ArrowDown"],
    when: (event: KeyboardEvent) => event.target === button,
    run: (event: KeyboardEvent) => {
      const lines = [...(button?.closest(".ask-content")?.querySelectorAll<HTMLButtonElement>('button.ask-line, button.ask-open') ?? [])];
      const index = lines.findIndex((row) => row === button);
      lines[index + (event.key === "ArrowDown" ? 1 : -1)]?.focus();
    },
  }];

  registerKeys({ kind: "region", element: () => button }, arrows);
  registerKeys(props.keys, arrows);

  const node = () => (props.workstream === null ? undefined : rail.nodes.find((each) => each.id === props.workstream));

  const open = (): void => {
    const target = node();

    if (target) props.open(target.id);
  };

  /** U505: once typed, the Door's own live Status; never text a model wrote. */
  const status = () => (props.live && props.part.state === "typed" ? node()?.status ?? null : null);
  const dismissed = () => node() !== undefined && rail.dismissed(node()!);
  const asking = () => !props.entry.pending && (props.part.state === "waiting" || props.part.state === "failed");
  const busy = () => asks.picking(props.entry.key, props.index);
  const failure = () => asks.partFailure(props.entry.key, props.index);

  const pick = (target: Target): void => void asks.pick(props.entry.key, props.index, target);

  const candidates = () => (props.part.placement.kind === "unclear" ? props.part.placement.candidates : []);
  const others = () => rail.nodes.filter((each) => each.kind === "workstream" && !candidates().includes(each.id));

  const linked = () => findTargets(props.part.text, true).length > 0;

  const line = (trigger: TriggerProps) => (
    <>
      <span {...(isTextCut() ? trigger : {})} ref={text} class="ask-text"
        onFocusIn={event => {
          if (event.target instanceof HTMLAnchorElement) {
            setIsLinkFocused(true);
            event.target.scrollIntoView({ block: "nearest", inline: "nearest" });
          }
        }}
        onFocusOut={event => {
          setIsLinkFocused(false);

          if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) event.currentTarget.scrollLeft = 0;
        }}><TargetText objectLinks text={props.part.text} base={node()?.worktree?.path ?? project.path} /></span>
      <span class="ask-where">
        <Show when={status()}>{(live) => <Tip text={live().kind === "error" ? live().label : LABELS[live().kind]}>{(trigger) => <span {...trigger()} class="ask-kind"><KindGlyph kind={shownKind(live(), dismissed())} /></span>}</Tip>}</Show>
        <Tip text={props.where} disabled={!isNameCut()}>{(trigger) => <span {...trigger()} ref={name} class="ask-name">{props.where}</span>}</Tip>
      </span>
      <span class="ask-state" data-state={props.part.state}>{STATE_WORDS[props.part.state]}</span>
    </>
  );

  return (
    <li data-overview-item={props.entry.key + ":" + props.index} class="ask-row" data-state={props.part.state}>
      <Tip class="ask-tip" text={tooltip()} disabled={!tooltip() || isLinkFocused()}>{(trigger, focus) => {
        const tip = trigger();

        return <Dynamic component={node() && !linked() ? "button" : "div"} {...focus} onClick={open}
          ref={(element: HTMLElement) => { if (element instanceof HTMLButtonElement) button = element; }} class={`ask-line ${node() ? "row-wash" : ""}`} data-linked={linked() ? "true" : undefined} data-feedback="ink">
          <Show when={node() && linked()}><button type="button" class="ask-open" data-feedback="ink" aria-label={`${props.part.text} ${props.where} ${STATE_WORDS[props.part.state]}`} ref={element => { button = element; }} /></Show>
          {line(tip)}
        </Dynamic>;
      }}</Tip>
      <Show when={!dismissed()}><FailureLine status={status()} action={DISMISS_ONLY} onDismiss={() => { const each = node();

 if (each) rail.dismiss(each); }} /></Show>
      <Show when={asking()}>
        <div class="ask-back">
          <p class="ask-reason">{props.part.reason ?? (props.part.placement.kind === "unclear" ? props.part.placement.question : "")}</p>
          <div class="ask-choices">
            <For each={candidates()}>
              {(id) => <button type="button" data-button="quiet" disabled={busy()} onClick={() => pick({ kind: "workstream", id })}>{rail.nodes.find((each) => each.id === id)?.name ?? id}</button>}
            </For>
            <Show when={others().length > 0}>
              <Select label={copy.askAnotherWorkstream} value="" choices={[{ value: "", label: copy.askAnotherWorkstream }, ...others().map((each) => ({ value: each.id, label: each.name }))]}
                onValueChange={(id) => { if (id !== "" && !busy()) pick({ kind: "workstream", id }); }} />
            </Show>
            <button type="button" data-button="quiet" disabled={busy()} onClick={() => pick({ kind: "new" })}>{copy.askNewWorkstream}</button>
            <button type="button" data-button="quiet" disabled={busy()} onClick={() => pick({ kind: "drop" })}>{copy.askDrop}</button>
          </div>
          <ReservedLine message={failure()?.message} action={DISMISS_ONLY} onDismiss={() => { const each = failure();

 if (each) asks.dismiss(each); }} />
        </div>
      </Show>
    </li>
  );
};
