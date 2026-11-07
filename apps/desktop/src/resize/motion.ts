import { drawerSliding } from "../drawer/sliding";
import { shelfSliding } from "../shelf/sliding";
import { resizeDragging } from "./dragging";

/** U389, U430, U371: true while the centre is changing width; the Terminal is fitted once it settles. */
export const layoutMoving = (): boolean => resizeDragging() || drawerSliding() || shelfSliding();
