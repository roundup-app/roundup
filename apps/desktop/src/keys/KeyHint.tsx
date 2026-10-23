import "./styles.css";
import type { JSX } from "solid-js";
import { Show } from "solid-js";
import { KeyChip } from "./KeyChip";

/** U2541d: the one layout of a key beside its label; the chip never leaves its label's line. */
export const KeyHint = (props: { keys: string; children: JSX.Element; chipAfter?: boolean; class?: string; labelClass?: string }) => {
  const label = () => <span class={`key-hint-label ${props.labelClass ?? ""}`}>{props.children}</span>;

  return (
    <span class={`hint key-hint ${props.class ?? ""}`}>
      <Show when={props.chipAfter} fallback={<><KeyChip keys={props.keys} />{" "}{label()}</>}>{label()}{" "}<KeyChip keys={props.keys} /></Show>
    </span>
  );
};
