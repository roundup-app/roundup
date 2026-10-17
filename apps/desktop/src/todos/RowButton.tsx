import { copy } from "../copy";
import type { JSX } from "solid-js";
import "./rowButton.styles.css";

/** A clickable row of the Shelf or a Drawer: plain text, no button chrome; a long title wraps under its `#`, not under the glyph; `hang={false}` is the Shelf's (U359), whose Glyph is its own column. */
export const RowButton = (props: { onClick: (event: MouseEvent) => void; pressed?: boolean | undefined; children: JSX.Element; ref?: (row: HTMLButtonElement) => void; reorderable?: boolean; hang?: boolean; label?: string; onKeyDown?: (event: KeyboardEvent) => void}) => (
  <button
    type="button"
    class="todo-row-button"
    ref={props.ref}
    aria-label={props.label}
    data-reorderable={props.reorderable ? "" : undefined}
    aria-description={props.reorderable ? copy.reorder : undefined}
    aria-pressed={props.pressed}
    onClick={(event) => props.onClick(event)}
    on:keydown={(event) => props.onKeyDown?.(event)}
    style={props.hang === false ? { display: "block" } : { display: "block", "white-space": "pre-wrap", "padding-left": "var(--todo-row-indent)", "text-indent": "calc(-1 * var(--todo-row-indent))" }}
  >
    {props.children}
  </button>
);
