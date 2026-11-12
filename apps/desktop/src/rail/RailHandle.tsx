import { Icon } from "../ink/Icon";
import { KeyHint } from "../keys/KeyHint";
import { LEADER, leaderKeys } from "../keys/chords";
import { IconButton } from "../ui/IconButton";
import { Tip } from "../ui/Tip";
import { copy } from "../header/copy";

/** U6228h: the one control that folds and opens the Rail, a half-disc on the Rail's trailing edge. Its arrow points where the Rail will go. */
export const RailHandle = (props: { collapsed: boolean; peek: boolean; slide: "click" | "key" | "fade" | undefined; dragging: boolean; onToggle: () => void }) => {
  const name = () => props.collapsed ? copy.expandRail : copy.collapseRail;

  return (
    <div class="rail-handle" data-collapsed={props.collapsed || undefined} data-peek={props.peek || undefined} data-slide={props.slide} data-dragging={props.dragging || undefined}>
      <Tip class="" content={<KeyHint chipAfter keys={leaderKeys(LEADER["leader.rail"])}>{name()}</KeyHint>}>
        {(trigger) => <IconButton bare {...trigger({ type: "button", "aria-expanded": !props.collapsed, onClick: () => props.onToggle() })} aria-label={name()} class="rail-handle-button"><Icon name={props.collapsed ? "right" : "left"} /></IconButton>}
      </Tip>
    </div>
  );
};
