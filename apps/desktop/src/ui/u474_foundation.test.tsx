import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "@babel/parser";
import { isJSXElement, isJSXText, isJSXExpressionContainer, isJSXEmptyExpression, isJSXIdentifier, traverseFast, type JSXElement } from "@babel/types";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { u474Fixture } from "./u474Fixture";
import packageJson from "../../package.json";
import { AlertDialog, Dialog, Menu, Tooltip, IconButton } from "./index";

afterEach(cleanup);

it("u474_icon_button_has_its_name", () => {
  render(u474Fixture);
  expect(screen.getByRole("button", { name: "Open Project" }).dataset.button).toBe("icon");
});

// u474_icon_button_requires_a_name: tsc checks both sides without mounting invalid UI.
const u474_icon_button_requires_a_name = () => {
  const named = <IconButton aria-label="Close Project">×</IconButton>;
  // @ts-expect-error An icon alone is not an accessible name.
  const unnamed = <IconButton>×</IconButton>;

  return [named, unnamed];
};

void u474_icon_button_requires_a_name;

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

it("u477_app_has_no_raw_icon_only_buttons", () => {
  const files = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(directory, entry.name)) : entry.name.endsWith(".tsx") && !entry.name.includes("test") ? [join(directory, entry.name)] : []);

  const visibleText = (element: JSXElement): boolean => {
    if (element.openingElement.attributes.some(attribute => attribute.type === "JSXAttribute" && (isJSXIdentifier(attribute.name, { name: "aria-hidden" }) || (isJSXIdentifier(attribute.name, { name: "class" }) && attribute.value?.type === "StringLiteral" && attribute.value.value === "door-action-label")))) return false;

    if (isJSXIdentifier(element.openingElement.name) && ["Icon", "OwnerMark", "KindGlyph", "ListFilter", "svg"].includes(element.openingElement.name.name)) return false;

    return element.children.some(child => isJSXText(child) ? child.value.trim().length > 0 : isJSXElement(child) ? visibleText(child) : isJSXExpressionContainer(child) && !isJSXEmptyExpression(child.expression));
  };

  const failures: string[] = [];

  for (const file of files("src")) {
    if (file === "src/ui/index.tsx") continue;
    traverseFast(parse(readFileSync(file, "utf8"), { sourceType: "module", plugins: ["typescript", "jsx"] }), node => {
      if (isJSXElement(node) && isJSXIdentifier(node.openingElement.name, { name: "button" }) && !visibleText(node)) failures.push(`${file}:${node.loc?.start.line}`);
    });
  }

  expect(failures).toEqual([]);
});
