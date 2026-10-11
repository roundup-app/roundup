import type { JSX } from "solid-js";
import "./rowButton.styles.css";

/** A clickable row of the Shelf or a Drawer: plain text, no button chrome; a long title wraps under its `#`, not under the glyph; `hang={false}` is the Shelf's (U359), whose Glyph is its own column. */
export const RowButton = (props: { onClick: () => void; children: JSX.Element; ref?: (row: HTMLButtonElement) => void; reorderable?: boolean; hang?: boolean; label?: string; onKeyDown?: (event: KeyboardEvent) => void; onPointerDown?: (event: PointerEvent) => void }) => (
  <button
    type="button"
    class="todo-row-button"
    ref={props.ref}
    aria-label={props.label}
    data-reorderable={props.reorderable ? "" : undefined}
    aria-description={props.reorderable ? "Alt+Up or Alt+Down moves it" : undefined}
    onClick={() => props.onClick()}
    onKeyDown={(event) => props.onKeyDown?.(event)}
    onPointerDown={(event) => props.onPointerDown?.(event)}
    style={props.hang === false ? { display: "block" } : { display: "block", "white-space": "pre-wrap", "padding-left": "var(--todo-row-indent)", "text-indent": "calc(-1 * var(--todo-row-indent))" }}
  >
    {props.children}
  </button>
);
