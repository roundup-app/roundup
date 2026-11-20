import { createSignal, Show } from "solid-js";
import { applying } from "../app/pending";
import { useConnectedProject } from "../state/connectedProject";
import { createCutTitle } from "../ui/cutTitle";
import { NameField } from "../ui/NameField";

/** A Pad's title in the open Pad: a double-click edits it in place (U7641a), and the Pad's Drawer follows the new name. */
export const PadTitle = (props: {
  name: string;
  incarnation: string;
  /** Present when the title can be edited; called with the name the Pad now has. */
  onRenamed?: ((name: string) => void) | undefined;
  /** A Pad that is gone cannot be renamed. */
  locked: boolean;
  reload: () => Promise<void>;
  fail: (message: string | null) => void;
  /** Where focus goes once the field closes. */
  returnFocus: () => void;
}) => {
  const connected = useConnectedProject();
  const cut = createCutTitle(() => props.name);
  const [renaming, setRenaming] = createSignal(false);

  const rename = async (text: string, base: string, incarnation: string | null) => {
    if (incarnation === null) throw new Error("A Pad rename needs the incarnation read on opening.");
    const result = await applying(() => connected.app.rpc("pad.rename", { name: base, newName: text, expectedIncarnation: incarnation }));

    if (result.kind !== "applied") throw result.error;
    await props.reload();
    props.onRenamed?.(text);
  };

  const close = (restore = true) => {
    setRenaming(false);

    if (restore) queueMicrotask(props.returnFocus);
  };

  return <Show when={renaming()} fallback={<span {...cut.attrs()} class="pad-head-name" onDblClick={() => setRenaming(props.onRenamed !== undefined && !props.locked)}>{props.name}</span>}>
    <NameField object={`pad:${props.incarnation}`} name={props.name} version={() => Promise.resolve(props.incarnation)} commit={rename} close={close} fail={props.fail} />
  </Show>;
};
