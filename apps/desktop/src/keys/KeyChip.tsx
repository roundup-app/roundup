import "./styles.css";
import { For } from "solid-js";

/** U2541d: one `<kbd>` per press (a chord's modifiers stay inside it); alternatives and sequences share one pair element. */
export const KeyChip = (props: { keys: string }) => (
  <span class="key-chips"><For each={props.keys.split(/\s+/u).filter((press) => press !== "" && press !== "/")}>{(press, index) =>
    <>{index() > 0 ? " " : ""}<kbd class="key-chip">{press}</kbd></>
  }</For></span>
);
