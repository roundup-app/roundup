import { onCleanup, onMount } from "solid-js";
import type { StripTab } from "./tab";

/** `<k> Agents run: <name>, <name>, <name>.` with at most three names, then `and <j> more` (U184). */
const runningText = (names: readonly string[]): string => {
  const shown = names.slice(0, 3).join(", ");
  const more = names.length > 3 ? ` and ${names.length - 3} more` : "";

  return `${names.length} ${names.length === 1 ? "Agent runs" : "Agents run"}: ${shown}${more}.`;
};

/** The one question before a tab with running Agents closes (U184): focus starts on `cancel`, and `esc` or a click outside cancels. */
export const CloseDialog = (props: { tab: StripTab; onCancel: () => void; onStop: () => void }) => {
  let panel: HTMLElement | undefined;
  let cancel: HTMLButtonElement | undefined;
  const returnTo = document.activeElement;

  const leave = () => {
    props.onCancel();

    if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus();
  };

  // Window capture runs before every other listener: while the question is open no key reaches a Terminal or a chord.
  const onKey = (press: KeyboardEvent) => {
    press.stopPropagation();

    if (press.key === "Escape") {
      press.preventDefault();
      leave();
    } else if (press.key === "Tab") {
      const words = [...(panel?.querySelectorAll("button") ?? [])];
      const at = words.findIndex((word) => word === document.activeElement);

      press.preventDefault();
      words[(at + (press.shiftKey ? words.length - 1 : 1)) % words.length]?.focus();
    }
  };

  const onClick = (click: MouseEvent) => {
    if (click.target instanceof Node && panel?.contains(click.target)) return;

    click.stopPropagation();
    click.preventDefault();
    leave();
  };

  onMount(() => cancel?.focus());
  window.addEventListener("keydown", onKey, true);
  document.addEventListener("click", onClick, true);
  onCleanup(() => {
    window.removeEventListener("keydown", onKey, true);
    document.removeEventListener("click", onClick, true);
  });

  return (
    <section class="close-dialog" role="alertdialog" aria-modal="true" aria-labelledby="close-title" aria-describedby="close-detail" ref={(element) => (panel = element)}>
      <p id="close-title">{`Close ${props.tab.name}?`}</p>
      <p id="close-detail">
        {runningText(props.tab.running)}
        <br />
        Closing stops them.
      </p>
      <p class="close-words">
        <button data-button="quiet" type="button" class="word" ref={(element) => (cancel = element)} onClick={leave}>
          cancel
        </button>
        <button data-button="quiet" type="button" class="word" onClick={() => props.onStop()}>
          stop and close
        </button>
      </p>
    </section>
  );
};
