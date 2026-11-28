import { railSliding } from "../rail/sliding";
import { drawerSliding } from "../drawer/sliding";
import { shelfSliding } from "../shelf/sliding";
import { resizeDragging } from "./dragging";

/** U389, U430, U371: true while the centre is changing width; the Terminal is fitted once it settles. */
export const layoutMoving = (): boolean => resizeDragging() || drawerSliding() || shelfSliding() || railSliding();

const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

/** U7610b: resolves once the centre has stopped changing width. It looks a frame late, so a fold asked for in the frame that drew the caller has started by then; a test DOM slides at once. */
export const layoutRested = async () => {
  if (!("getAnimations" in Element.prototype)) return;

  await nextFrame();

  while (layoutMoving()) await nextFrame();
};
