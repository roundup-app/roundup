import type { JSX } from "solid-js";

const OPTIONS = [
  { label: "all", all: true },
  { label: "this one", all: false },
] as const;

/** U368, U159, U347: the `all` / `this one` choice as one segmented control of two quiet buttons; `←` and `→` move focus between them, and a press acts at once. */
export const ScopeControl = (props: { showAll: boolean; onChange: (showAll: boolean) => void }) => {
  const onKey: JSX.EventHandler<HTMLDivElement, KeyboardEvent> = (press) => {
    if (press.key !== "ArrowLeft" && press.key !== "ArrowRight") return;

    const buttons = [...press.currentTarget.querySelectorAll("button")];
    const at = buttons.findIndex((button) => button === document.activeElement);

    if (at < 0) return;

    press.preventDefault();
    buttons[(at + (press.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length]?.focus();
  };

  return (
    <div class="scope-line">
      <div role="group" aria-label="show Todos" class="scope-control" onKeyDown={onKey}>
        {OPTIONS.map((option) => (
          <button data-button="quiet" type="button" aria-pressed={props.showAll === option.all} onClick={() => props.onChange(option.all)}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
};
