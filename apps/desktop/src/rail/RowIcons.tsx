import { Index } from "solid-js";
import { Icon } from "../ink/Icon";
import type { IconName } from "../ink/Icon";

/** U426: one icon of a Rail row's group: a mark, its label (also its `title`, unless `title` says more) and what a press does. */
export type RowIcon = {
  name: IconName;
  label: string;
  title?: string;
  disabled?: boolean;
  /** The pressed button, for an action that opens something at it. */
  onPress: (button: HTMLElement) => void;
  /** The add's `model…` pick, reached with ⌥-click or the context-menu key (U378). */
  onMore?: () => void;
};

/** U426: the icons at a row's right edge. While the row is not near the pointer, focus or selection they leave the layout but not the Tab order, so showing them moves no row. */
export const RowIcons = (props: { icons: readonly RowIcon[]; shown: boolean }) => (
  <span class="rail-icons" role="none" data-shown={props.shown}>
    <Index each={props.icons}>
      {(icon) => (
        <button
          data-button="icon"
          type="button"
          aria-label={icon().label}
          title={icon().title ?? icon().label}
          aria-disabled={icon().disabled ? true : undefined}
          aria-haspopup={icon().onMore ? "dialog" : undefined}
          onClick={(click) => {
            click.stopPropagation();

            const more = icon().onMore;

            if (more && click.altKey) more();
            else icon().onPress(click.currentTarget);
          }}
          onContextMenu={(press) => {
            const more = icon().onMore;

            if (!more) return;

            press.preventDefault();
            press.stopPropagation();
            more();
          }}
        >
          <Icon name={icon().name} />
        </button>
      )}
    </Index>
  </span>
);
