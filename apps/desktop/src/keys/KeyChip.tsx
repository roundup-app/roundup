import "./styles.css";
import { For } from "solid-js";

/** U2541: native keyboard semantics shared by every shortcut surface. */
export const KeyChip = (props: { keys: string }) => (
  <span class="key-chips"><For each={Array.from(props.keys)}>{(symbol) =>
    /\s/.test(symbol) ? symbol : <kbd class="key-chip">{symbol}</kbd>
  }</For></span>
);
