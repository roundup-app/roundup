import { createSignal } from "solid-js";
import { captureFocus } from "../keys/focus";
import type { PadEditorHandle } from "./PadRichEditor";
import { stepOfHeading, walkSteps } from "./walkSteps";

type Reading = {
  /** A kept draft or an invalid Pad opens in Edit. */
  kept: () => boolean;
  text: string;
  name: string;
  origin: () => string;
  initialFocus: ReturnType<typeof captureFocus>;
  editor: () => PadEditorHandle | undefined;
  /** Saves what the editor holds and reports whether it is saved with no failure showing. */
  save: () => Promise<boolean>;
  act: (work: () => Promise<void>) => Promise<void>;
  /** The editor unmounts: the handle it gave is stale. */
  release: () => void;
};

/** PW11, PW12: whether a Pad shows as its walk, the step it returns to, and the Edit and Done actions between the two. */
export const createPadReading = (o: Reading) => {
  const [reading, setReading] = createSignal(!o.kept() && o.text.trim() !== "");
  const [walkAt, setWalkAt] = createSignal<number | undefined>(undefined);
  /** PW11: `first` holds until Edit is pressed, so only the editor mounted at open restores a draft or scrolls to a heading. */
  const mount = { first: true };
  let editFocus = o.initialFocus;
  const before = document.activeElement;

  const edit = () => {
    editFocus = captureFocus();
    mount.first = false;
    setReading(false);
  };

  const done = () => o.act(async () => {
    if (!await o.save()) return;

    const heading = o.editor()?.caretHeading();
    const at = heading ? stepOfHeading(walkSteps(o.origin(), o.name), heading) : -1;

    setWalkAt(at >= 0 ? at : undefined);
    o.release();
    setReading(true);
  });

  /** PW5: a finished walk hands focus back to where it came from. */
  const finish = () => { if (before instanceof HTMLElement && before.isConnected) before.focus({ preventScroll: true }); };

  return { reading, walkAt, edit, done, finish, editFocus: () => editFocus, mount };
};
