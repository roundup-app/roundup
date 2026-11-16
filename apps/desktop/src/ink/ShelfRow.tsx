import { omit, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import "../ui/Row.css";

/** U359: the one row of the Shelf's lists, a Todo's and a Pad's alike: a 16 px Glyph, then a text column (title, then at most one quiet meta line) whose every line starts at the title's left edge. */
export const ShelfRow = (props: { glyph: JSX.Element; /** U361: a separately ordered title before the Glyph and meta controls. */ head?: JSX.Element; children?: JSX.Element } & Omit<JSX.HTMLAttributes<HTMLDivElement>, "children">) => {
  const rest = omit(props, "glyph", "head", "children", "class");

  return (
    <div {...rest} class={props.class ? `shelf-row row-wash ${props.class}` : "shelf-row row-wash"}>
      {props.head !== undefined ? <div class="shelf-head">{props.head}</div> : null}
      <Show when={props.glyph}>{glyph => <span class="shelf-glyph">{glyph()}</span>}</Show>
      <div class="shelf-text">{props.children}</div>
    </div>
  );
};
