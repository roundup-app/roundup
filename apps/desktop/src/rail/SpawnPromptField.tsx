import { copy } from "../copy";

const promptOf = (text: string): string | null => {
  const trimmed = text.trim();

  return trimmed === "" ? null : trimmed;
};

/** U2227: grows to its text; the CSS max-height caps it at 6 lines, then it scrolls. */
const fit = (field: HTMLTextAreaElement) => {
  field.style.height = "auto";
  field.style.height = `${field.scrollHeight}px`;
};

export const SpawnPromptField = (props: {
  value: string;
  onInput: (text: string) => void;
  onSubmit: (prompt: string | null) => void;
  onCancel: () => void;
  ref: (field: HTMLTextAreaElement) => void;
}) => (
  <textarea
    aria-label={copy.task}
    placeholder={copy.taskHint}
    rows={1}
    class="spawn-prompt-field"
    value={props.value}
    ref={(field) => {
      queueMicrotask(() => {
        field.focus();
        field.setSelectionRange(field.value.length, field.value.length);
        fit(field);
      });
      props.ref(field);
    }}
    onInput={(typed) => {
      fit(typed.currentTarget);
      props.onInput(typed.currentTarget.value);
    }}
    onKeyDown={(press) => {
      if (press.key === "Enter" && !press.shiftKey && !press.isComposing) {
        press.preventDefault();
        props.onSubmit(promptOf(press.currentTarget.value));
      } else if (press.key === "Escape") props.onCancel();
    }}
  />
);
