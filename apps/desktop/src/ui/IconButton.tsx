import { mergeProps, Show, splitProps, type JSX } from "solid-js";
import { ariaChord, CHORDS, type ChordName } from "../keys/chords";
import { copy } from "./copy";
import { Icon } from "../ink/Icon";
import { Tip, type TriggerProps } from "./Tip";

const triggerProps = (rest: JSX.ButtonHTMLAttributes<HTMLButtonElement>, chord: () => Parameters<typeof ariaChord>[0], click: JSX.EventHandler<HTMLButtonElement, MouseEvent>) => {
  const merged = mergeProps({ type: "button" as const }, rest, { get "aria-keyshortcuts"() { return ariaChord(chord()); } }, { onClick: click });

  // SAFETY: `rest` holds only button attributes; the same props the trigger spreads onto a button, typed for HTMLElement.
  return merged as TriggerProps;
};

export const IconButton = (props: Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & { "aria-label": string; action?: ChordName | undefined; tooltip?: string | undefined; /** The name shows elsewhere (a peek, a visible label), so no tooltip. */ bare?: true }) => {
  const [local, rest] = splitProps(props, ["class", "onClick", "action", "tooltip", "bare"]);

  const click: JSX.EventHandler<HTMLButtonElement, MouseEvent> = (event) => {
    if (props["aria-disabled"] === true || props["aria-disabled"] === "true") {
      event.preventDefault();
      event.stopPropagation();

      return;
    }

    const handler = local.onClick;

    if (!handler) return;

    if (0 in handler) handler[0](handler[1], event);
    else handler(event);
  };

  const chord = () => local.action && CHORDS[local.action];

  const barePlain = mergeProps({ type: "button" as const }, rest, { onClick: click });

  // Tip: Escape belongs to the surrounding App surface; blur and pointer leave dismiss the name.
  return <Show when={!local.bare} fallback={<button {...barePlain} data-button="icon" class={`word ${local.class ?? ""}`} />}><Tip text={local.tooltip ?? props["aria-label"]} chord={chord()}>
    {(trigger) => {
      const merged = triggerProps(rest, chord, click);

      return <button {...trigger(merged)} data-button="icon" class={`word ${local.class ?? ""}`} />;
    }}
  </Tip></Show>;
};

/** The App's return control retains its caller's navigation and focus ownership. */
export const ExitButton = (props: Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children">) =>
  <IconButton {...props} aria-label={copy.close}><Icon name="x" /></IconButton>;
