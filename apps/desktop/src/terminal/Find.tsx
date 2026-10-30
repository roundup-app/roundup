import { createSignal, onMount, Show } from "solid-js";
import { Field } from "../ui/Field";
import { copy } from "./copy";

/** Z3788a: the floating Find of the focused Terminal. Enter and Shift+Enter step through matches, Escape closes it. */
export const Find = (props: { query: string; setQuery: (query: string) => void; find: (query: string, backwards: boolean) => boolean; close: () => void }) => {
  const [missed, setMissed] = createSignal(false);
  let input!: HTMLInputElement;

  const step = (backwards: boolean): void => { setMissed(props.query !== "" && !props.find(props.query, backwards)); };

  onMount(() => { input.focus(); input.select(); });

  return (
    <Field.Root class="terminal-find" invalid={missed()}>
      <Field.Input
        ref={input}
        type="search"
        aria-label={copy.findLabel}
        value={props.query}
        onInput={(event) => { props.setQuery(event.currentTarget.value); step(false); }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            props.close();
          } else if (event.key === "Enter") {
            event.preventDefault();
            step(event.shiftKey);
          }
        }}
      />
      <Show when={missed()}><Field.ErrorText role="status">{copy.findNoMatch}</Field.ErrorText></Show>
    </Field.Root>
  );
};
