import { createUniqueId } from "solid-js";

/** U159, U347: the `todos` header's native radio pair, `this one` (on until the user chooses `all`) and `all`; it governs the `pads` list too; the radios are the words' own inputs, so the keyboard is the browser's. */
export const WorkstreamChoice = (props: { showAll: boolean; onChange: (showAll: boolean) => void }) => {
  const name = `todos-shown-${createUniqueId()}`;

  return (
    <span role="radiogroup" aria-label="todos shown" class="shown-choice">
      {[
        { label: "this one", value: false },
        { label: "all", value: true },
      ].map((option) => (
        <label class="word shown-word">
          <input
            type="radio"
            name={name}
            checked={props.showAll === option.value}
            onChange={() => props.onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </span>
  );
};
