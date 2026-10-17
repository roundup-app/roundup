import { createMemo, For, Show } from "solid-js";
import type { AskPart } from "@contracts/ask/AskPart";
import type { Target } from "@contracts/ask/Target";
import { copy } from "../copy";
import { ErrorLine } from "../ink/ErrorLine";
import { KindGlyph, LABELS } from "../ink/KindGlyph";
import { useConnectedProject } from "../state/connectedProject";
import type { AskEntry } from "../state/asks";
import { Select } from "../ui";

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
export const AskRows = () => {
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
    focusPane();
  };

  return (
    <ul class="ask-rows" aria-label={copy.askRows}>
      <For each={parts()}>
        {({ entry, part, index }) => <AskRow entry={entry} part={part} index={index} where={where(part)} workstream={workstreamOf(part)} open={open} />}
      </For>
    </ul>
  );
};

const AskRow = (props: { entry: AskEntry; part: AskPart; index: number; where: string; workstream: string | null; open: (id: string) => void }) => {
  const { asks, rail } = useConnectedProject();

  const node = () => (props.workstream === null ? undefined : rail.nodes.find((each) => each.id === props.workstream));
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
      <span class="ask-text">{props.part.text}</span>
      <span class="ask-where">{props.where}</span>
      <span class="ask-state" data-state={props.part.state}>
        <Show when={status()} fallback={STATE_WORDS[props.part.state]}>
          {(live) => <><KindGlyph kind={live().kind} decorative /><span>{LABELS[live().kind]}</span></>}
        </Show>
      </span>
    </>
  );

  return (
    <li class="ask-row" data-state={props.part.state}>
      <Show when={node()} fallback={<div class="ask-line">{line()}</div>}>
        {(target) => <button type="button" class="ask-line" data-feedback="ink" onClick={() => props.open(target().id)}>{line()}</button>}
      </Show>
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
