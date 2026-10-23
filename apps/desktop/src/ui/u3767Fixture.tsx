import { render } from "solid-js/web";
import { Dialog } from "./Dialog";
import { Menu } from "./Menu";
import { Select } from "./Select";
import "../tokens.css";
import "../styles.css";
import "../buttons.css";

render(() => <Dialog.Root open>
  <Dialog.Positioner><Dialog.Content>
    <Dialog.Title>Import</Dialog.Title>
    <Menu.Root>
      <Menu.Trigger data-button="quiet">Actions</Menu.Trigger>
      <Menu.Positioner><Menu.Content><Menu.Item value="one">One</Menu.Item></Menu.Content></Menu.Positioner>
    </Menu.Root>
    <Select label="Kind" value="a" onValueChange={() => {}} choices={[{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }]} />
  </Dialog.Content></Dialog.Positioner>
</Dialog.Root>, document.getElementById("root")!);
