import { Icon } from "../ink/Icon";
import { IconButton } from "./IconButton";

/** U7889e: the ▶ beside a printed command: a named button whose visibility the caller sets with `data-shown`; focus shows it too. */
export const PlayMark = (props: { name: string; row: number; span: number; shown: boolean; run: () => void }) => (
  <IconButton
    bare
    class="play-mark"
    aria-label={props.name}
    data-shown={props.shown ? "" : undefined}
    style={{ "--play-row": props.row, "--play-span": props.span }}
    onMouseDown={(press) => press.preventDefault()}
    onClick={() => props.run()}
  >
    <Icon name="play" filled />
  </IconButton>
);
