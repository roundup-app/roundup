import { createSignal, lazy, Match, Switch } from "solid-js";
import type { RailMenuModel } from "./menu/model";
import { ModePrompt } from "./OpeningPrompt";
import { SaveAsMode } from "./SaveAsMode";

const CreateMode = lazy(() => import("./CreateMode").then(module => ({ default: module.CreateMode })));

/** The Rail's dialogs exclude each other: one signal says which is open. */
type RailDialog = { kind: "create-mode" } | { kind: "opening-prompt"; id: string } | { kind: "save-as-mode"; id: string };

export const createRailDialogs = () => {
  const [dialog, open] = createSignal<RailDialog | null>(null);

  return { dialog, open, close: () => open(null) };
};

export type RailDialogs = ReturnType<typeof createRailDialogs>;

export const RailDialogHost = (props: {
  dialogs: RailDialogs;
  rowElement: (id: string) => HTMLElement | undefined;
  restartMode: (id: string) => ReturnType<RailMenuModel["restartMode"]>;
  created: (id: string, request: string) => void;
}) => {
  const saving = () => {
    const open = props.dialogs.dialog();

    return open?.kind === "save-as-mode" ? open : undefined;
  };

  const prompting = () => {
    const open = props.dialogs.dialog();

    return open?.kind === "opening-prompt" ? open : undefined;
  };

  return (
    <Switch>
      <Match when={saving()} keyed>{open => <SaveAsMode id={open.id} onClose={props.dialogs.close} finalFocus={() => props.rowElement(open.id) ?? null} />}</Match>
      <Match when={prompting()} keyed>{open => <ModePrompt restart={() => props.restartMode(open.id)} id={open.id} onClose={props.dialogs.close} finalFocus={() => props.rowElement(open.id) ?? null} />}</Match>
      <Match when={props.dialogs.dialog()?.kind === "create-mode"}><CreateMode finalFocus={id => props.rowElement(id) ?? null} onClose={props.dialogs.close} onCreated={props.created} /></Match>
    </Switch>
  );
};
