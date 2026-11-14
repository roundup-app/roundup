import { copy } from "../copy";
import { useConnectedProject } from "../../state/connectedProject";
import type { Confirming, RailMenuModel } from "./model";
import { removalQuestion } from "./removal";
import { NativeAlert } from "../../ui/NativeAlert";

const questionOf = (current: Confirming | null, lossesOf: RailMenuModel["lossesOf"]) => {
  switch (current?.kind) {
    case undefined:
      return { title: "", message: "", okLabel: copy.remove, cancelLabel: copy.keep };
    case "stop":
      return { title: copy.stopQuestion(current.node.name), message: "", okLabel: copy.stop, cancelLabel: copy.keep };
    case "remove-selection":
      return { title: copy.removeSelectionQuestion, message: current.summary, okLabel: copy.removeAll, cancelLabel: copy.keep };
    case "remove": {
      if (current.removal !== null && current.removal !== "reading") return removalQuestion(current.removal, current.node.name);

      return {
        title: current.node.kind === "workstream" || current.exit !== null ? copy.removeQuestion(current.node.name) : copy.stopAndRemoveQuestion(current.node.name),
        message: lossesOf([current.node]).join("\n"),
        okLabel: copy.remove,
        cancelLabel: copy.keep,
      };
    }
  }
};

const nodeOf = (current: Confirming | null) => current?.kind === "remove-selection" ? current.nodes[0] : current?.node;

/** Consequences are read before the native question is shown. */
export const RailConfirm = (props: { menu: RailMenuModel; rowElement: (id: string) => HTMLElement | undefined }) => {
  const { app, rail } = useConnectedProject();
  const current = () => props.menu.state();

  const asking = () => {
    const kept = current();

    return kept !== null && !(kept.kind === "remove" && kept.removal === "reading");
  };

  let target: HTMLElement | null = null;
  let removedFromKeyboard = false;

  return <NativeAlert app={app} open={asking()}
    question={questionOf(current(), props.menu.lossesOf)}
    onConfirm={(answer) => {
      const kept = current();
      const node = nodeOf(kept);
      removedFromKeyboard = kept?.kind === "remove" && kept.removed !== undefined;
      target = node ? props.rowElement(node.id) ?? null : null;

      if (kept?.kind === "stop") return props.menu.chooseStop(kept.node);

      return props.menu.chooseRemove(answer === "all" ? "all" : "this");
    }}
    onCancel={() => {
      const node = nodeOf(current());
      removedFromKeyboard = false;
      target = node ? props.rowElement(node.id) ?? null : null;
      props.menu.close();
    }}
    finalFocus={() => removedFromKeyboard ? props.rowElement(rail.selected() ?? "") ?? null : target?.isConnected ? target : null} />;
};
