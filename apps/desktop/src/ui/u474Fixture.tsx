import { createSignal } from "solid-js";
import { AlertDialog, Dialog } from "./Dialog";
import { IconButton } from "./IconButton";
import { Menu } from "./Menu";
import { Tooltip } from "./Tooltip";
import "../tokens.css";
import "../styles.css";
import "../buttons.css";

export const u474Fixture = () => {
  const [chosen, setChosen] = createSignal(0);

  return <>
    <Dialog.Root initialFocusEl={() => document.getElementById("dialog-cancel")}>
      <Dialog.Trigger data-button="quiet">Open Dialog</Dialog.Trigger>
      <Dialog.Positioner><Dialog.Content>
        <Dialog.Title>Project question</Dialog.Title>
        <Dialog.Description>Keep the Project open?</Dialog.Description>
        <Dialog.CloseTrigger id="dialog-cancel" data-button="quiet">Cancel</Dialog.CloseTrigger>
        <button type="button" data-button="quiet">Keep</button>
      </Dialog.Content></Dialog.Positioner>
    </Dialog.Root>
    <AlertDialog.Root>
      <AlertDialog.Trigger data-button="quiet">Open AlertDialog</AlertDialog.Trigger>
      <AlertDialog.Content>
        <AlertDialog.Title>Close Project?</AlertDialog.Title>
        <AlertDialog.Description>Closing stops Agents.</AlertDialog.Description>
        <AlertDialog.CloseTrigger data-button="quiet">Cancel</AlertDialog.CloseTrigger>
      </AlertDialog.Content>
    </AlertDialog.Root>
    <Menu.Root onSelect={() => setChosen(chosen() + 1)}>
      <Menu.Trigger data-button="quiet">Project actions</Menu.Trigger>
      <Menu.Positioner><Menu.Content>
        <Menu.Item value="open">Open Project</Menu.Item>
        <Menu.Item value="close">Close Project</Menu.Item>
      </Menu.Content></Menu.Positioner>
    </Menu.Root>
    <output aria-label="Actions taken">{chosen()}</output>
    <Tooltip.Root openDelay={0} closeDelay={0}>
      <Tooltip.Trigger data-button="quiet">Project explanation</Tooltip.Trigger>
      <Tooltip.Positioner><Tooltip.Content>Project contains Agents.</Tooltip.Content></Tooltip.Positioner>
    </Tooltip.Root>
    <IconButton aria-label="Open Project" id="fixture-icon" data-fixture="ordinary" aria-expanded={false}
      ref={(button) => { button.dataset.refConnected = "true"; }} onClick={() => setChosen(chosen() + 1)}>+</IconButton>
    <IconButton aria-label="Unavailable action" aria-disabled onClick={() => setChosen(chosen() + 1)}>×</IconButton>
    <button type="button" data-button="quiet">End</button>
    <IconButton aria-label="Bound action" onClick={[setChosen, 2]}>+</IconButton>
  </>;
};
