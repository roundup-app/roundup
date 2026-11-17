import { merge, omit, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { ariaChord, CHORDS, type ChordName } from "../keys/chords";
import { copy } from "./copy";
import { Icon } from "../ink/Icon";
import { Tip, type TriggerProps } from "./Tip";
import { tipName, type UniversalIcon } from "./universalIcons";
import type { Chord } from "../keys/chords";

const triggerProps = (rest: JSX.ButtonHTMLAttributes<HTMLButtonElement>, chord: () => Parameters<typeof ariaChord>[0], click: JSX.EventHandler<HTMLButtonElement, MouseEvent>) => {
  const merged = merge({ type: "button" as const }, rest, { get "aria-keyshortcuts"() { return ariaChord(chord()); } }, { onClick: click });

  // SAFETY: `rest` holds only button attributes; the same props the trigger spreads onto a button, typed for HTMLElement.
  return merged as TriggerProps;
};

export const IconButton = (props: Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & { "aria-label": string; action?: ChordName | undefined; /** A key the registry names outside `CHORDS`. */ chord?: Chord | undefined; /** U7413a: the role of a universal icon, which shows no name tooltip. */ icon?: UniversalIcon | undefined; tooltip?: string | undefined; /** The name shows elsewhere (a peek, a visible label), so no tooltip. */ bare?: true }) => {
  // The icon is the button's own child, not a spread prop: a spread re-reads every prop when one changes (the chord on focus), and a re-made icon between pointer down and up drops the click.
  const rest = omit(props, "class", "onClick", "action", "chord", "icon", "tooltip", "bare", "children");

  const click: JSX.EventHandler<HTMLButtonElement, MouseEvent> = (event) => {
    if (props["aria-disabled"] === "true") {
      event.preventDefault();
      event.stopPropagation();

      return;
    }

    const handler = props.onClick;

    if (!handler) return;

    if (0 in handler) handler[0](handler[1], event);
    else handler(event);
  };

  const chord = () => props.chord ?? (props.action && CHORDS[props.action]);

  const name = () => tipName(props.icon, props.tooltip, props["aria-label"]);

  const barePlain = merge({ type: "button" as const }, rest, { onClick: click });

  // Tip: Escape belongs to the surrounding App surface; blur and pointer leave dismiss the name.
  return <Show when={!props.bare} fallback={<button {...barePlain} data-button="icon" class={`word ${props.class ?? ""}`}>{props.children}</button>}><Tip text={name()} chord={chord()} disabled={name() === undefined && !chord()}>
    {(trigger) => {
      const merged = triggerProps(rest, chord, click);

      return <button {...trigger(merged)} data-button="icon" class={`word ${props.class ?? ""}`}>{props.children}</button>;
    }}
  </Tip></Show>;
};

/** The App's return control retains its caller's navigation and focus ownership. */
export const ExitButton = (props: Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children">) =>
  <IconButton {...props} icon="close" aria-label={copy.close}><Icon name="x" /></IconButton>;
