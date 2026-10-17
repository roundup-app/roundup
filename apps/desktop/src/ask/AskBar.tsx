import { createEffect, createMemo, createSignal, Show } from "solid-js";
import { copy } from "../copy";
import { ErrorLine } from "../ink/ErrorLine";
import { useConnectedProject } from "../state/connectedProject";
import { Mentions } from "../ui";
import { AskRows } from "./AskRows";
import "./styles.css";

/** The leading `@` and the letters after it, while the user has not yet typed the space that ends the name (U504). */
const mentionOf = (text: string): string | null => /^@(\S*)$/.exec(text)?.[1] ?? null;

/** U504: the Ask bar and its rows. The Project's home screen while the Rail selects no Workstream; U2241 leaves it no key of its own. */
export const AskBar = () => {
  const { asks, rail } = useConnectedProject();
  const [text, setText] = createSignal("");
  const [failure, setFailure] = createSignal<string | null>(null);
  const [highlighted, setHighlighted] = createSignal<string | null>(null);
  let field: HTMLTextAreaElement | undefined;

  // With no Workstream at all the Pane's "New Workstream" is the way in, so home leaves it uncovered.
  const shown = () => rail.selected() === null && rail.nodes.length > 0;

  asks.load();

  const names = createMemo(() => rail.nodes.filter((node) => node.kind === "workstream").map((node) => ({ value: node.name, label: node.name })));

  const matching = createMemo(() => {
    const typed = mentionOf(text());

    return typed === null ? [] : names().filter((item) => item.label.toLowerCase().includes(typed.toLowerCase()));
  });

  createEffect(() => {
    const list = matching();

    if (!list.some((item) => item.value === highlighted())) setHighlighted(list[0]?.value ?? null);
  });

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
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;

    event.preventDefault();

    const picked = matching().length > 0 ? highlighted() : null;

    if (picked !== null) complete(picked);
    else send();
  };

  return (
    <Show when={shown()}>
      <section class="ask-bar" aria-label={copy.askBarLabel}>
        <Mentions.Root items={matching()} highlightedValue={highlighted()} onHighlightChange={setHighlighted} onSelect={complete}>
          <Mentions.Field class="ask-input" ref={(element: HTMLTextAreaElement) => { field = element; }}
            rows={1} aria-label={copy.askBarLabel} placeholder={copy.askBarPlaceholder} value={text()} open={matching().length > 0}
            onInput={(event) => setText(event.currentTarget.value)} onKey={onKey} />
          <Show when={matching().length > 0}><Mentions.List label={copy.askMentions} items={matching()} /></Show>
        </Mentions.Root>
        <Show when={failure() ?? asks.failure()}>{(message) => <ErrorLine message={message()} />}</Show>
        <AskRows />
      </section>
    </Show>
  );
};
