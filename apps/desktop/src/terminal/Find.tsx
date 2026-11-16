import { createSignal, onSettled } from "solid-js";
import { ReservedLine } from "../ink/ReservedLine";
import { Field } from "../ui/Field";
import { copy } from "./copy";

/** Z3788a: the floating Find of the focused Terminal. Enter and Shift+Enter step through matches, Escape closes it. */
export const Find = (props: { query: string; setQuery: (query: string) => void; find: (query: string, backwards: boolean) => boolean; close: () => void }) => {
  const [missed, setMissed] = createSignal(false);
  let input!: HTMLInputElement;

  const step = (query: string, backwards: boolean): void => { setMissed(query !== "" && !props.find(query, backwards)); };

  onSettled(() => { input.focus(); input.select(); });

  return (
    <Field.Root class="terminal-find">
      <Field.Input
        ref={input}
        type="text"
        placeholder={copy.findLabel}
        aria-label={copy.findLabel}
        value={props.query}
        // `props.query` still holds the old text until the write lands, so the new text steps directly.
        onInput={(event) => { props.setQuery(event.currentTarget.value); step(event.currentTarget.value, false); }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            props.close();
          } else if (event.key === "Enter") {
            event.preventDefault();
            step(props.query, event.shiftKey);
          }
        }}
      />
      <ReservedLine class="terminal-find-miss" status={missed() ? copy.findNoMatch : null} />
    </Field.Root>
  );
};
