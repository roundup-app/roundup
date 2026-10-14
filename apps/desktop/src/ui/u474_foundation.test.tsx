import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import packageJson from "../../package.json";
import { AlertDialog, Dialog, Menu, Tooltip, IconButton } from "./index";

afterEach(cleanup);

it("u474_icon_button_has_its_name", () => {
  render(() => <IconButton aria-label="Close Project">×</IconButton>);
  expect(screen.getByRole("button", { name: "Close Project" }).dataset.button).toBe("icon");
});

// u474_icon_button_requires_a_name: tsc checks both sides of the contract.
const named = <IconButton aria-label="Close Project">×</IconButton>;

// @ts-expect-error An icon alone is not an accessible name.
const unnamed = <IconButton>×</IconButton>;

void [named, unnamed];

it("u474_dependency_and_exports", () => {
  expect(packageJson.dependencies["@ark-ui/solid"]).toMatch(/^\^?5\./);
  render(() => <>
    <Dialog.Root><Dialog.Content><Dialog.Title>Project</Dialog.Title></Dialog.Content></Dialog.Root>
    <AlertDialog.Root><AlertDialog.Content><AlertDialog.Title>Close Project?</AlertDialog.Title></AlertDialog.Content></AlertDialog.Root>
    <Menu.Root><Menu.Trigger>Project actions</Menu.Trigger><Menu.Positioner><Menu.Content><Menu.Item value="close">Close</Menu.Item></Menu.Content></Menu.Positioner></Menu.Root>
    <Tooltip.Root><Tooltip.Trigger>Project</Tooltip.Trigger><Tooltip.Positioner><Tooltip.Content>Open Project</Tooltip.Content></Tooltip.Positioner></Tooltip.Root>
  </>);
  expect(screen.getByRole("button", { name: "Project actions" })).toBeDefined();
});
