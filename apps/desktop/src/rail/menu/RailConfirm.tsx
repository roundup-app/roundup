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
    const held = current();
    const removal = held?.removal;

    return {
      title: held ? held.action === "stop" ? copy.stopQuestion(held.node.name) : (held.node.kind === "workstream" || held.exit !== null) ? copy.removeQuestion(held.node.name) : copy.stopAndRemoveQuestion(held.node.name) : "",
      message: removal ? [goesLine(removal), ...goingNames(removal), staysLine(removal), ...removal.stays.agents.map(stay => copy.toastLine(stay.name, stay.reason))].filter(Boolean).join("\n") : "",
      okLabel: held?.action === "stop" ? copy.stop : copy.remove,
      cancelLabel: copy.keep,
    };
  };

  let target: HTMLElement | null = null;
  let removedFromKeyboard = false;

  return <NativeAlert app={app} open={current()?.confirming === true && current()?.removal !== null}
    question={question()}
    onConfirm={() => {
      const held = current();
      removedFromKeyboard = held?.action === "remove" && held.removed !== undefined;
      target = held ? props.rowElement(held.node.id) ?? null : null;

      if (held?.action === "stop") return props.menu.chooseStop();

      return props.menu.chooseRemove();
    }}
    onCancel={() => {
      const held = current();
      removedFromKeyboard = false;
      target = held ? props.rowElement(held.node.id) ?? null : null;
      props.menu.close();
    }}
    finalFocus={() => removedFromKeyboard ? props.rowElement(rail.selected() ?? "") ?? null : target?.isConnected ? target : null} />;
};
