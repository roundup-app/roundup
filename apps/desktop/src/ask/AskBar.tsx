import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { copy } from "../copy";
import { Icon } from "../ink/Icon";
import { ErrorLine } from "../ink/ErrorLine";
import { ASK_CLOSE, CHORDS, chordsFor } from "../keys/chords";
import { registerKeys, type KeyScope } from "../keys/registry";
import { useConnectedProject } from "../state/connectedProject";
import { Mentions } from "../ui/Mentions";
import { KindGlyph, LABELS } from "../ink/KindGlyph";
import { attentionOrder } from "../rail/attention";
import { descendantsOf, resolvedWorkstream, siblingsOf } from "../rail/layout";
import { Tip } from "../ui/Tip";
import type { RailNode } from "@contracts/agent/RailNode";
import { AskRows } from "./AskRows";
import "./styles.css";

/** The leading `@` and the letters after it, while the user has not yet typed the space that ends the name (U504). */
const mentionOf = (text: string): string | null => /^@(\S*)$/.exec(text)?.[1] ?? null;

/** U504: the Ask bar and its rows. The Project's home screen while the Rail selects no Workstream, and `⌘/` opens it over anything else; Escape closes that and returns focus. */
export const AskBar = () => {
  const { asks, rail, daemonExit } = useConnectedProject();
  const [over, setOver] = createSignal(false);
  const [text, setText] = createSignal("");
  const [failure, setFailure] = createSignal<string | null>(null);
  const [dismissed, setDismissed] = createSignal(false);
  const [highlighted, setHighlighted] = createSignal<string | null>(null);
  let panel: HTMLElement | undefined;
  let field: HTMLTextAreaElement | undefined;
  let returnTo: Element | null = null;

  // With no Workstream at all the Pane's "New Workstream" is the way in, so home leaves it uncovered.
  const shown = () => over() || (rail.selected() === null && rail.nodes.length > 0);

  asks.load();

  const names = createMemo(() => rail.nodes.filter((node) => node.kind === "workstream").map((node) => ({ value: node.name, label: node.name })));

  const matching = createMemo(() => {
    const typed = mentionOf(text());

    return dismissed() || typed === null ? [] : names().filter((item) => item.label.toLowerCase().includes(typed.toLowerCase()));
  });

  createEffect(() => {
    const list = matching();

    if (!list.some((item) => item.value === highlighted())) setHighlighted(list[0]?.value ?? null);
  });

  const close = (restore: boolean): void => {
    setOver(false);

    if (restore && returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus();
  };

  const open = (): void => {
    returnTo = document.activeElement;
    setOver(true);
    queueMicrotask(() => field?.focus());
  };

  registerKeys({ kind: "app" }, [{
    action: CHORDS.find((row) => row.keys === "⌘/")!,
    when: () => daemonExit() === null && !over(),
    capture: () => ({ available: () => daemonExit() === null && !over(),
    invoke: open }),
  }]);
  const scope: KeyScope = { kind: "layer", element: () => panel, active: over, modal: true };

  registerKeys(scope, [
    { chords: chordsFor("⌘/"), run: (press) => { if (!press.repeat) close(true); } },
    { chords: ASK_CLOSE, run: () => { if (matching().length > 0) setDismissed(true); else close(true); } },
  ]);

  const send = (): void => {
    const value = text();

    if (value.trim() === "") return;

    setText("");
    setFailure(null);
    void asks.send(value).then((message) => {
      if (message === null) return;

      setFailure(copy.askNotSent + message);
      setText((now) => (now === "" ? value : now));
    });
  };

  const complete = (name: string): void => {
    setText(`@${name} `);
    field?.focus();
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && matching().length > 0) {
      event.preventDefault();
      event.stopPropagation();
      setDismissed(true);

      return;
    }

    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;

    event.preventDefault();

    const picked = matching().length > 0 ? highlighted() : null;

    if (picked !== null) complete(picked);
    else send();
  };

  return (
    <Show when={shown()}>
      <section class="ask-bar" data-mode={over() ? "over" : "home"} aria-label={copy.askBarLabel} ref={(element) => { panel = element; }}>
        <Mentions.Root items={matching()} highlightedValue={highlighted()} onHighlightChange={setHighlighted} onSelect={complete}>
          <Mentions.Field class="ask-input" ref={(element: HTMLTextAreaElement) => { field = element; }}
            rows={1} aria-label={copy.askBarLabel} placeholder={copy.askBarPlaceholder} value={text()} open={matching().length > 0}
            onInput={(event) => { setDismissed(false); setText(event.currentTarget.value); }} onKey={onKey} />
          <Show when={matching().length > 0}><Mentions.List label={copy.askMentions} items={matching()} /></Show>
        </Mentions.Root>
        <Show when={failure() ?? asks.failure()}>{(message) => <ErrorLine message={message()} />}</Show>
        <Show when={!over()}><ProjectOverview /></Show>
        <AskRows keys={scope} onOpened={() => close(false)} />
      </section>
    </Show>
  );
};

const ProjectOverview = () => {
  const { rail } = useConnectedProject();
  const attention = createMemo(() => attentionOrder(rail.nodes));
  const workstreams = createMemo(() => siblingsOf(rail.nodes, null).flatMap((node) => [node, ...descendantsOf(rail.nodes, node.id)]).filter((node) => node.kind === "workstream"));
  const under = (id: string | null) => attention().filter((node) => resolvedWorkstream(rail.nodes, node.id) === id);

  const entry = (node: RailNode, waiting = false) => <OverviewEntry node={node} waiting={waiting} select={() => rail.select(node.id)} />;

  return <section class="project-overview" aria-label={copy.projectOverview}>
    <Show when={rail.failure()}>{(message) => <ErrorLine message={message()} />}</Show>
    <Show when={attention().length > 0} fallback={<div class="empty-state overview-empty">
      <Icon name="check" />
      <h2 class="overview-heading" data-state="attention">{copy.projectAttention(0)}</h2>
    </div>}>
      <h2 class="overview-heading" data-state="attention">{copy.projectAttention(attention().length)}</h2>
    </Show>
    <ul class="overview-list">
      <For each={workstreams()}>{(node) => <li>
        {entry(node)}
        <Show when={under(node.id).length > 0}><ul class="overview-attention">
          <For each={under(node.id)}>{(agent) => <li>{entry(agent, true)}</li>}</For>
        </ul></Show>
      </li>}</For>
      <For each={under(null)}>{(node) => <li>{entry(node, true)}</li>}</For>
    </ul>
  </section>;
};

const OverviewEntry = (props: { node: RailNode; waiting: boolean; select: () => void }) => {
  const [cut, setCut] = createSignal(false);
  let name: HTMLSpanElement | undefined;
  const measure = () => setCut(!!name && name.scrollWidth > name.clientWidth);

  createEffect(() => {
    if (props.node.name) queueMicrotask(measure);
  });
  onMount(() => {
    if (!name) return;
    const observer = new ResizeObserver(measure);

    observer.observe(name);
    onCleanup(() => observer.disconnect());
  });

  return <button onClick={props.select} type="button" class="overview-entry"
    aria-label={[props.node.name, props.node.status ? LABELS[props.node.status.kind] : ""].filter(Boolean).join(" ")}
    data-feedback="ink" data-button="quiet" onPointerEnter={measure}>
    <Tip text={props.node.status ? LABELS[props.node.status.kind] : ""} disabled={!props.node.status}>{(trigger) =>
      <span {...trigger()} class={props.waiting ? "overview-state ink" : "overview-state"} data-state={props.node.status?.kind} data-tone={props.node.status?.kind === "error" ? "red" : undefined}>
        <Show when={props.node.status}>{(status) => <KindGlyph kind={status().kind} />}</Show>
      </span>
    }</Tip>
    <Tip text={props.node.name} disabled={!cut()}>{(trigger) =>
      <span {...trigger()} ref={name} class={props.waiting ? "overview-name ink" : "overview-name"}>{props.node.name}</span>
    }</Tip>
  </button>;
};
