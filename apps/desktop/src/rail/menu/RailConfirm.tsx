import { copy } from "../copy";
import { useConnectedProject } from "../../state/connectedProject";
import type { Confirming, RailMenuModel } from "./model";
import { removalQuestion } from "./removal";
import { NativeAlert } from "../../ui/NativeAlert";

const idle = { title: "", message: "", okLabel: copy.remove, cancelLabel: copy.keep };

/** What the native alert asks; `null` while a confirm has nothing to ask yet, as while a removal's consequences are read. */
const questionOf = (confirming: Confirming | null) => {
  if (confirming === null) return null;

  switch (confirming.kind) {
    case "reading-selection": return null;
    case "stop": return { title: copy.stopQuestion(confirming.node.name), message: "", okLabel: copy.stop, cancelLabel: copy.keep };
    case "remove-selection": return { title: copy.removeSelectionQuestion, message: confirming.summary, okLabel: copy.removeAll, cancelLabel: copy.keep };
    case "remove":
      if (confirming.removal === "reading") return null;

      if (confirming.removal !== null) return removalQuestion(confirming.removal, confirming.node.name);

      return {
        title: confirming.node.kind === "workstream" || confirming.exit !== null ? copy.removeQuestion(confirming.node.name) : copy.stopAndRemoveQuestion(confirming.node.name),
        message: confirming.losses.join("\n"),
        okLabel: copy.remove,
        cancelLabel: copy.keep,
      };
  }
};

/** The row a confirm is about, where focus returns. */
const rowIdOf = (confirming: Confirming | null) => {
  if (confirming === null) return null;

  switch (confirming.kind) {
    case "stop":
    case "remove": return confirming.node.id;
    case "remove-selection": return confirming.nodes[0].id;
    case "reading-selection": return null;
  }
};

/** Consequences are read before the native question is shown. */
export const RailConfirm = (props: { menu: RailMenuModel; rowElement: (id: string) => HTMLElement | undefined }) => {
  const { app, rail } = useConnectedProject();
  const question = () => questionOf(props.menu.confirming());
  let target: HTMLElement | null = null;
  let removedFromKeyboard = false;

  const aboutRow = () => {
    const row = rowIdOf(props.menu.confirming());

    return row === null ? null : props.rowElement(row) ?? null;
  };

  return <NativeAlert app={app} open={question() !== null}
    question={question() ?? idle}
    onConfirm={(answer) => {
      const kept = props.menu.confirming();
      removedFromKeyboard = (kept?.kind === "remove" || kept?.kind === "remove-selection") && kept.removed !== undefined;
      target = aboutRow();

      return props.menu.confirm(answer === "all" ? "all" : "this");
    }}
    onCancel={() => {
      removedFromKeyboard = false;
      target = aboutRow();
      props.menu.close();
    }}
    finalFocus={() => removedFromKeyboard ? props.rowElement(rail.selected() ?? "") ?? null : target?.isConnected ? target : null} />;
};
