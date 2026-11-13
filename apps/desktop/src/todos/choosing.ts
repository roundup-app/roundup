import type { captureFocus } from "../keys/focus";

export type Permission = ReturnType<typeof captureFocus>;

export type Advance = (permission?: Permission) => Promise<void>;

/**
 * U3487a: the one thing a Todo is being chosen for. Its pending advance rides in the variant, so closing a picker ends it
 * and a later action starts from its own row and order (U3487b). `comment` has no picker: the Drawer's comment ends it.
 */
export type Choosing =
  | { kind: "owner"; id: number; anchor: HTMLElement; focus: Permission; advance?: Advance | undefined }
  | { kind: "home"; id: number; anchor: HTMLElement; focus: Permission; advance?: Advance | undefined }
  | { kind: "name"; id: number; focus: Permission }
  | { kind: "comment"; id: number; focus: Permission; advance?: Advance | undefined };
