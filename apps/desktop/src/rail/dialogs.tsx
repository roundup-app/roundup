import { lazy, Show, untrack } from "solid-js";
import { useConnectedProject } from "../state/connectedProject";
import type { RailMenuModel } from "./menu/model";
import { ModePrompt } from "./OpeningPrompt";
import { SaveAsMode } from "./SaveAsMode";

const CreateMode = lazy(() => import("./CreateMode").then(module => ({ default: module.CreateMode })));

/** The one dialog the Rail has open; it is the single answer to whether one is. */
export type RailDialog =
  | { kind: "create-mode" }
  | { kind: "opening-prompt"; id: string }
  | { kind: "save-as-mode"; id: string };

export const RailDialogs = (props: { dialog: () => RailDialog | null; close: () => void; menu: RailMenuModel; rowElement: (id: string) => HTMLElement | undefined }) => {
  const { rail } = useConnectedProject();
  const rowOf = (id: string) => props.rowElement(id) ?? null;

  return <Show when={props.dialog()} keyed>{dialog => {
    switch (dialog.kind) {
      case "create-mode": return <CreateMode finalFocus={rowOf} onClose={props.close} onCreated={(id, request) => {
        props.close();
        // The arriving Mode Agent must not reuse the selection permission to take focus from this row.
        const focus = rail.terminalFocus();
        queueMicrotask(() => untrack(() => focus(() => props.rowElement(id)?.focus({ preventScroll: true }))));
        void props.menu.restartMode(id, request);
      }} />;
      case "opening-prompt": return <ModePrompt restart={() => props.menu.restartMode(dialog.id)} id={dialog.id} onClose={props.close} finalFocus={() => rowOf(dialog.id)} />;
      case "save-as-mode": return <SaveAsMode id={dialog.id} onClose={props.close} finalFocus={() => rowOf(dialog.id)} />;
    }
  }}</Show>;
};
