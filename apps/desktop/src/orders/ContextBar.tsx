import { ReservedLine } from "../ink/ReservedLine";
import { For, Show, createMemo, createSignal } from "solid-js";
import type { ConversationOverview } from "@contracts/agent/ConversationOverview";
import type { ContextPartKind } from "@contracts/agent/ContextPartKind";
import { copy } from "../copy";

type Part = { kind: ContextPartKind | "used"; label: string; tokens: number };

const compact = (value: number) => new Intl.NumberFormat("en", { notation: "compact" }).format(value);

const percentOf = (tokens: number, limit: number) => Math.round(tokens / limit * 100);

/** U83b: the model limit as one bar, filled in order by the parts of what the Adapter measured. */
export const ContextBar = (props: { overview: ConversationOverview }) => {
  const [active, setActive] = createSignal<number | null>(null);
  let list: HTMLUListElement | undefined;
  const used = () => props.overview.used;
  const limit = () => props.overview.limit;

  const parts = createMemo<Part[]>(() => {
    const total = used() ?? 0;
    const split = props.overview.context_parts;

    return split?.length
      ? split.map((part) => ({ kind: part.kind, label: copy.contextPart[part.kind], tokens: part.tokens }))
      : [{ kind: "used", label: copy.contextUsed, tokens: total }];
  });

  const percent = () => percentOf(used()!, limit()!);
  const warning = () => percent() >= 95 ? copy.contextFull : percent() >= 80 ? copy.contextNear : null;

  const spoken = () => {
    const part = parts()[active() ?? -1];

    return part && limit() ? copy.contextExact(part.label, part.tokens, percentOf(part.tokens, limit()!)) : "";
  };

  const move = (event: KeyboardEvent, index: number) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;

    if (!step) return;
    event.preventDefault();
    const next = (index + step + parts().length) % parts().length;
    list?.querySelectorAll("button")[next]?.focus();
  };

  return (
    <Show when={used() !== undefined}>
      <div class="context-bar-box">
        <p class="context-line">
          <span>{limit() ? copy.contextOf(used()!, limit()!) : compact(used()!)}</span>
          <Show when={limit()}>
            <span class="context-percent" data-warn={warning() ? "" : undefined}>
              {copy.percent(percent())}{warning() ? ` ${warning()}` : ""}
            </span>
          </Show>
        </p>
        <Show when={limit()}>
          <div class="context-bar" role="meter" aria-label={copy.context} aria-valuemin={0} aria-valuenow={used()} aria-valuemax={limit()} aria-valuetext={copy.contextValueText(used()!, limit()!, percent())} onMouseLeave={() => setActive(null)}>
            <For each={parts()}>
              {(part, index) => (
                <span class="context-part" data-kind={part.kind} data-dim={active() !== null && active() !== index() ? "" : undefined}
                  style={{ width: `${part.tokens / limit()! * 100}%` }} onMouseEnter={() => setActive(index())} />
              )}
            </For>
          </div>
          <ul class="context-list" ref={list} aria-label={copy.context}>
            <For each={parts()}>
              {(part, index) => (
                <li data-dim={active() !== null && active() !== index() ? "" : undefined} onMouseEnter={() => setActive(index())} onMouseLeave={() => setActive(null)}>
                  <button type="button" data-button="quiet" tabindex={(active() ?? 0) === index() ? 0 : -1} onFocus={() => setActive(index())} onBlur={() => setActive(null)} onKeyDown={(event) => move(event, index())}>
                    <span class="context-swatch" data-kind={part.kind} aria-hidden="true" />
                    <span>{part.label}</span>
                    <span class="context-tokens">{compact(part.tokens)}</span>
                  </button>
                </li>
              )}
            </For>
          </ul>
          <ReservedLine class="context-live" status={spoken()} aria-live="polite" />
        </Show>
      </div>
    </Show>
  );
};
