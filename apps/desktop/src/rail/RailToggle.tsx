import { Icon } from "../ink/Icon";
import { KeyHint } from "../keys/KeyHint";
import { LEADER, leaderKeys } from "../keys/chords";
import { IconButton } from "../ui/IconButton";
import { Tip } from "../ui/Tip";
import { copy } from "./copy";

/** The open Rail's header and the strip each hold the button, so a press that had focus hands it to the one now shown (U7156a: focus stays on the button). */
const pressed = (press: MouseEvent & { currentTarget: HTMLElement }, opening: boolean, toggle: () => void) => {
  const button = press.currentTarget;
  const rail = button.closest(".rail");
  const focused = document.activeElement === button;

  toggle();

  // Opening hands focus to the body's copy, which outlives the slide; the strip's copy unmounts when it ends.
  if (focused) requestAnimationFrame(() => rail?.querySelector<HTMLElement>(opening ? ".rail-body .rail-toggle" : ".rail-strip-head .rail-toggle")?.focus());
};

/** U7156a: the one control that folds and opens the Rail. It is rendered inside the Rail's header and inside the strip, so it rides the Rail's own slide and has no position of its own. */
export const RailToggle = (props: { collapsed: boolean; onToggle: () => void }) => {
  const name = () => props.collapsed ? copy.expandRail : copy.collapseRail;

  return (
    <Tip class="" content={<KeyHint chipAfter keys={leaderKeys(LEADER["leader.rail"])}>{name()}</KeyHint>}>
      {(trigger) => <IconButton bare {...trigger({ "aria-expanded": props.collapsed ? "false" : "true", onClick: (press: MouseEvent & { currentTarget: HTMLElement }) => pressed(press, props.collapsed, props.onToggle) })} aria-label={name()} class="rail-toggle"><Icon name={props.collapsed ? "panel-left-open" : "panel-left-close"} /></IconButton>}
    </Tip>
  );
};
