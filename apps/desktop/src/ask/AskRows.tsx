import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import type { AskPart } from "@contracts/ask/AskPart";
import type { Target } from "@contracts/ask/Target";
import { copy } from "../copy";
import { ErrorLine } from "../ink/ErrorLine";
import { KindGlyph, LABELS } from "../ink/KindGlyph";
import { useConnectedProject } from "../state/connectedProject";
import type { AskEntry } from "../state/asks";
import { registerKeys, type KeyScope } from "../keys/registry";
import { Tip } from "../rail/Tip";
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

const focusPane = (): void => {
  document.querySelector<HTMLElement>(".pane-screen textarea, .pane-screen [tabindex]")?.focus();
};

/** U505, U506: one row for each part of each Ask, newest first. */
export const AskRows = (props: { onOpened: () => void; keys: KeyScope }) => {
  const { asks, rail } = useConnectedProject();

  const parts = createMemo(() => asks.entries().flatMap((entry) => entry.parts.map((part, index) => ({ entry, part, index }))));

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

  return (
    <ul class="ask-rows" aria-label={copy.askRows}>
      <For each={parts()}>
        {({ entry, part, index }) => <AskRow keys={props.keys} entry={entry} part={part} index={index} where={where(part)} workstream={workstreamOf(part)} open={open} />}
      </For>
    </ul>
  );
};

const AskRow = (props: { keys: KeyScope; entry: AskEntry; part: AskPart; index: number; where: string; workstream: string | null; open: (id: string) => void }) => {
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
      const rows = [...(button?.closest(".ask-rows")?.querySelectorAll<HTMLButtonElement>("button.ask-line") ?? [])];
      const index = rows.findIndex((row) => row === button);
      rows[index + (event.key === "ArrowDown" ? 1 : -1)]?.focus();
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
  const status = () => (props.part.state === "typed" ? node()?.status ?? null : null);
  const asking = () => !props.entry.pending && (props.part.state === "waiting" || props.part.state === "failed");
  const busy = () => asks.picking(props.entry.key, props.index);
  const failure = (): string | undefined => asks.pickFailure(props.entry.key, props.index);

  const pick = (target: Target): void => void asks.pick(props.entry.key, props.index, target);

  const candidates = () => (props.part.placement.kind === "unclear" ? props.part.placement.candidates : []);
  const others = () => rail.nodes.filter((each) => each.kind === "workstream" && !candidates().includes(each.id));

  const line = () => (
    <>
      <span ref={text} class="ask-text">{props.part.text}</span>
      <span class="ask-where">
        <span class="ask-kind" title={status() ? LABELS[status()!.kind] : undefined}>
          <Show when={status()}>{(live) => <KindGlyph kind={live().kind} />}</Show>
        </span>
        <span ref={name} class="ask-name">{props.where}</span>
      </span>
      <span class="ask-state" data-state={props.part.state}>{STATE_WORDS[props.part.state]}</span>
    </>
  );

  return (
    <li class="ask-row" data-state={props.part.state}>
      <Tip class="ask-tip" text={props.part.text + "\n" + props.where} disabled={!cut()}>
        {(trigger) => <Dynamic component={node() ? "button" : "div"} {...trigger({ onClick: open })}
          ref={(element: HTMLButtonElement | HTMLDivElement) => { button = element instanceof HTMLButtonElement ? element : undefined; }}
          type={node() ? "button" : undefined} class="ask-line" onPointerEnter={measure}>{line()}</Dynamic>}
      </Tip>
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
          <Show when={failure()}>{(message) => <ErrorLine message={message()} />}</Show>
        </div>
      </Show>
    </li>
  );
};
