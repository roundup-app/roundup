import type { KeyText } from "./chords";
import "./styles.css";
import { For } from "solid-js";

/** U2541d: one `<kbd>` per press (a chord's modifiers stay inside it); alternatives and sequences share one pair element. */
export const KeyChip = (props: { keys: KeyText }) => (
  <span class="key-chips"><For each={props.keys.split(/\s+/u).filter((press) => press !== "" && press !== "/")}>{(press, index) =>
    <>{index() > 0 ? " " : ""}<kbd class="key-chip"><For each={press.match(/[⌃⌥⇧⌘]|[^⌃⌥⇧⌘]+/gu) ?? []}>{key => <span>{key}</span>}</For></kbd></>
  }</For></span>
);
