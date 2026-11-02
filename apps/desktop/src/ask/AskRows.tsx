import { focusPane } from "../bubbles/focus";
import { Disclosure } from "../ui/Disclosure";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import type { AskPart } from "@contracts/ask/AskPart";
import type { Target } from "@contracts/ask/Target";
import { copy } from "./copy";
import { ReservedLine } from "../ink/ReservedLine";
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

  const live = () => parts().filter(row => !asks.acknowledged(row.entry, row.index));
  const earlier = () => parts().filter(row => asks.acknowledged(row.entry, row.index));

  const rows = (items: ReturnType<typeof parts>) => <ul class="ask-rows" aria-label={copy.askRows}>
    <For each={items}>{({ entry, part, index, live }) => <AskRow live={live} keys={props.keys} entry={entry} part={part} index={index} where={where(part)} workstream={workstreamOf(part)} open={open} />}</For>
  </ul>;

  return <Show when={parts().length > 0}><div class="ask-content">
    <Show when={live().length > 0}><section class="ask-parts" aria-label={copy.askRows}>

      {rows(live())}
    </section></Show>
    <Show when={earlier().length > 0}><Disclosure class="ask-earlier" label={copy.askEarlier(earlier().length)}>{rows(earlier())}</Disclosure></Show>
  </div></Show>;
};

const AskRow = (props: { live: boolean; keys: KeyScope; entry: AskEntry; part: AskPart; index: number; where: string; workstream: string | null; open: (id: string) => void }) => {
  const { asks, rail } = useConnectedProject();

  let button: HTMLButtonElement | undefined;
  let text: HTMLSpanElement | undefined;
  let name: HTMLSpanElement | undefined;
  const [cut, setCut] = createSignal(false);
  const measure = () => setCut([text, name].some((cell) => !!cell && cell.scrollWidth > cell.clientWidth));

  createEffect(() => {
    const content = props.part.text + props.where;

    if (content) queueMicrotask(measure);
  });
  onMount(() => {
    const observer = new ResizeObserver(measure);

    for (const cell of [text, name]) if (cell) observer.observe(cell);

    onCleanup(() => observer.disconnect());
  });

  const arrows = [{
    chords: ["ArrowUp", "ArrowDown"],
    when: (event: KeyboardEvent) => event.target === button,
    run: (event: KeyboardEvent) => {
      const lines = [...(button?.closest(".ask-content")?.querySelectorAll<HTMLButtonElement>("button.ask-line") ?? [])];
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

  const line = (trigger: TriggerProps) => (
    <>
      <span {...trigger} ref={text} class="ask-text">{props.part.text}</span>
      <span class="ask-where">
        <Show when={status()}>{(live) => <Tip text={live().kind === "error" ? live().label : LABELS[live().kind]}>{(trigger) => <span {...trigger()} class="ask-kind"><KindGlyph kind={shownKind(live(), dismissed())} /></span>}</Tip>}</Show>
        <Tip text={props.where} disabled={!cut()}>{(trigger) => <span {...trigger()} ref={name} class="ask-name">{props.where}</span>}</Tip>
      </span>
      <span class="ask-state" data-state={props.part.state}>{STATE_WORDS[props.part.state]}</span>
    </>
  );

  return (
    <li data-overview-item={props.entry.key + ":" + props.index} class="ask-row" data-state={props.part.state}>
      <Tip class="ask-tip" text={props.part.text + "\n" + props.where} disabled={!cut()}>{(trigger, focus) => {
        const tip = trigger();

        return <Dynamic {...focus} component={node() ? "button" : "div"} onClick={open}
          ref={(element: HTMLButtonElement | HTMLDivElement) => { button = element instanceof HTMLButtonElement ? element : undefined; }}
          type={node() ? "button" : undefined} class={`ask-line ${node() ? "row-wash" : ""}`} data-feedback="ink" onPointerEnter={measure}>{line(tip)}</Dynamic>;
      }}</Tip>
      <Show when={!dismissed()}><FailureLine status={status()} /></Show>
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
          <ReservedLine message={failure()?.message}><Show when={failure()}>{(each) => <button type="button" data-button="quiet" onClick={() => asks.dismiss(each())}>{copy.dismiss}</button>}</Show></ReservedLine>
        </div>
      </Show>
    </li>
  );
};
