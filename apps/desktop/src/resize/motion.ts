import { railAtStart, railSliding } from "../rail/sliding";
import { drawerSliding } from "../drawer/sliding";
import { shelfSliding } from "../shelf/sliding";
import { resizeDragging } from "./dragging";

/** U389, U430, U371: true while the centre is changing width; the Terminal is fitted once it settles. A Changes fold gave the centre its width at the click (U8075). */
export const layoutMoving = (): boolean => resizeDragging() || drawerSliding() || shelfSliding() || railSliding() && !railAtStart();

const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

/** U7610b: resolves once the centre has stopped changing width, a task after the caller asked. */
export const layoutRested = async () => {
  await new Promise(resolve => setTimeout(resolve));

  while (layoutMoving()) await nextFrame();
};
