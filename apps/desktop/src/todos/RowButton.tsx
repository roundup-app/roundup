import { modalOpen, registerKeys } from "../keys/registry";
import { copy } from "../copy";
import { type JSX } from "solid-js";
import { Tip } from "../ui/Tip";
import "./rowButton.styles.css";

/** A clickable row of the Shelf or a Drawer: plain text, no button chrome; a long title wraps under its `#`, not under the glyph; `hang={false}` is the Shelf's (U359), whose Glyph is its own column. */
export const RowButton = (props: { onClick: (event: MouseEvent) => void; pressed?: boolean | undefined; selectionActive?: boolean | undefined; children: JSX.Element; ref?: (row: HTMLButtonElement) => void; reorderable?: boolean; hang?: boolean; label?: string; tooltip?: string | undefined; onKeyDown?: (event: KeyboardEvent) => void; onPointerDown?: (event: PointerEvent) => void }) => {
  let button: HTMLButtonElement | undefined;

  if (props.onKeyDown) registerKeys({ kind: "layer", element: () => button, active: () => document.activeElement === button && !modalOpen(), modal: false }, [{
    chords: ["Meta+Enter", "ArrowUp", "ArrowDown", "Shift+ArrowUp", "Shift+ArrowDown", "Alt+ArrowUp", "Alt+ArrowDown", "Backspace", "Escape"],
    when: (event) => event.target === button
      && (event.altKey ? props.reorderable === true : props.pressed !== undefined)
      && ((event.key !== "Escape" && event.key !== "Backspace") || props.selectionActive === true),
    run: (event) => props.onKeyDown?.(event),
  }]);

  return (
    <Tip text={props.tooltip} class="todo-tooltip" disabled={!props.tooltip}>
      {(trigger) => <button {...trigger({
        onClick: (event: MouseEvent) => props.onClick(event),
        onPointerDown: (event: PointerEvent) => props.onPointerDown?.(event),
      })} type="button" class="todo-row-button"
        data-reorderable={props.reorderable ? "" : undefined}
        aria-label={props.label} aria-description={props.reorderable ? copy.reorder : undefined} aria-pressed={props.pressed}
        style={props.hang === false ? { display: "block" } : { display: "block", "white-space": "pre-wrap", "padding-left": "var(--todo-row-indent)", "text-indent": "calc(-1 * var(--todo-row-indent))" }}
        ref={(element) => { button = element; props.ref?.(element); }}>{props.children}</button>}
    </Tip>
  );
};
