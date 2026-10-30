import type { JSX } from "solid-js";
import { Show, splitProps } from "solid-js";
import "../ui/Row.css";

/** U359: the one row of the Shelf's lists, a Todo's and a Pad's alike: a 16 px Glyph, then a text column (title, then at most one quiet meta line) whose every line starts at the title's left edge. */
export const ShelfRow = (props: { glyph: JSX.Element; /** U361: a separately ordered title before the Glyph and meta controls. */ head?: JSX.Element; children?: JSX.Element } & Omit<JSX.HTMLAttributes<HTMLDivElement>, "children">) => {
  const [own, rest] = splitProps(props, ["glyph", "head", "children", "class"]);

  return (
    <div {...rest} class={own.class ? `shelf-row row-wash ${own.class}` : "shelf-row row-wash"}>
      {own.head !== undefined ? <div class="shelf-head">{own.head}</div> : null}
      <Show when={own.glyph}>{glyph => <span class="shelf-glyph">{glyph()}</span>}</Show>
      <div class="shelf-text">{own.children}</div>
    </div>
  );
};
