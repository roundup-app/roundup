import { copy } from "../../copy";
import { useConnectedProject } from "../../state/connectedProject";
import type { RailMenuModel } from "./model";
import { goesLine, goingNames, staysLine } from "./removal";
import { NativeAlert } from "../../ui/NativeAlert";

/** Consequences are read before the native question is shown. */
export const RailConfirm = (props: { menu: RailMenuModel; rowElement: (id: string) => HTMLElement | undefined }) => {
  const { app, rail } = useConnectedProject();
  const current = () => props.menu.state();

  const question = () => {
    const kept = current();
    const removal = kept?.removal;

    return {
      title: kept ? kept.action === "stop" ? copy.stopQuestion(kept.node.name) : (kept.node.kind === "workstream" || kept.exit !== null) ? copy.removeQuestion(kept.node.name) : copy.stopAndRemoveQuestion(kept.node.name) : "",
      message: removal ? [goesLine(removal), ...goingNames(removal), staysLine(removal), ...removal.stays.agents.map(stay => copy.toastLine(stay.name, stay.reason))].filter(Boolean).join("\n") : "",
      okLabel: kept?.action === "stop" ? copy.stop : copy.remove,
      cancelLabel: copy.keep,
    };
  };

  let target: HTMLElement | null = null;
  let removedFromKeyboard = false;

  return <NativeAlert app={app} open={current()?.confirming === true && current()?.removal !== null}
    question={question()}
    onConfirm={() => {
      const kept = current();
      removedFromKeyboard = kept?.action === "remove" && kept.removed !== undefined;
      target = kept ? props.rowElement(kept.node.id) ?? null : null;

      if (kept?.action === "stop") return props.menu.chooseStop();

      return props.menu.chooseRemove();
    }}
    onCancel={() => {
      const kept = current();
      removedFromKeyboard = false;
      target = kept ? props.rowElement(kept.node.id) ?? null : null;
      props.menu.close();
    }}
    finalFocus={() => removedFromKeyboard ? props.rowElement(rail.selected() ?? "") ?? null : target?.isConnected ? target : null} />;
};
