import { Icon } from "../ink/Icon";
import { KeyHint } from "../keys/KeyHint";
import { LEADER, leaderKeys } from "../keys/chords";
import { Tip } from "../ui/Tip";
import { copy } from "../header/copy";

/** U6228h: the one control that folds and opens the Rail, a half-disc on the Rail's trailing edge. Its arrow points where the Rail will go. */
export const RailHandle = (props: { collapsed: boolean; peek: boolean; slide: "click" | "key" | "fade" | undefined; dragging: boolean; onToggle: () => void }) => {
  const name = () => props.collapsed ? copy.expandRail : copy.collapseRail;

  return (
    <div class="rail-handle" data-peek={props.peek || undefined} data-slide={props.slide} data-dragging={props.dragging || undefined}>
      <Tip class="" content={<KeyHint chipAfter keys={leaderKeys(LEADER["leader.rail"])}>{name()}</KeyHint>}>
        {(trigger) => <button {...trigger({ type: "button", "aria-label": name(), "aria-expanded": !props.collapsed, onClick: () => props.onToggle() })} data-button="icon" class="word rail-handle-button"><Icon name={props.collapsed ? "right" : "left"} /></button>}
      </Tip>
    </div>
  );
};
