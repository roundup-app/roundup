import { readdirSync, readFileSync } from "node:fs";
import { parse } from "@babel/parser";
import { traverseFast, isJSXElement } from "@babel/types";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { u474Fixture } from "./u474Fixture";
import packageJson from "../../package.json";
import { AlertDialog, Dialog } from "./Dialog";
import { Menu } from "./Menu";
import { Tooltip } from "./Tooltip";
import { CHORDS } from "../keys/chords";
import { Tip } from "../ui/Tip";
import { copy } from "../copy";
import { IconButton } from "./IconButton";

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

// Exhaustive source audit: all other raw callers paint words, names or counts.
// Compact Rail actions and single-count Project edges can paint marks alone,
// so they remain explicitly inventoried even when a seed paints their labels.
// Stable name keys let each lane remove callers without editing this inventory.
// PadRichEditor.tsx mounts CrepeBuilder: every Milkdown-generated toolbar/link
// button is also owned by cancelled #1988; it produces no source JSX button.
// drawingBlock.ts mounts Excalidraw inside a rich Pad: its generated canvas
// toolbar, menus and action buttons likewise belong to cancelled #1988.
const rawIconOwners = new Map([
  ["drawer/DrawerHost.tsx:{copy.close}", "#1997 close Drawer"],
  ["header/ProjectTab.tsx:{copy.closeProject(props.tab.name)}", "#1605 close Project"],
  ["header/Strip.tsx:{copy.hiddenAttention(hidden().count, MARKS[hidden().mark].label.toLowerCase(), side)}", "#1605 hidden attention edge (single count paints marks only)"],
  ["header/Strip.tsx:{copy.openAFolder}", "#1605 add Project"],
  ["rail/RailRow.tsx:{copy.collapse}", "#1607 collapse Workstream"],
  ["rail/RailRow.tsx:{props.doorFailure ? copy.retryDoor : copy.startDoor}", "#1607 start/retry Door (label hidden in compact rows)"],
  ["rail/RowIcons.tsx:{props.label}", "#1607 clear/stop/open folder/open editor via RowIcon"],
  ["rail/RowIcons.tsx:{copy.addAgentLabel}", "#1607 add Agent (label hidden in compact rows)"],
  ["pads/PadDrawer.tsx:{copy.makeYours}", "#1988 cancelled: make yours"],
  ["pads/PadDrawer.tsx:{copy.openOwner}", "#1988 cancelled: open owner"],
  ["pads/PadDrawer.tsx:{copy.exportMd}", "#1988 cancelled: export"],
  ["pads/PadDrawer.tsx:{copy.delete}", "#1988 cancelled: delete"],
  ["pads/Pads.tsx:{copy.makePadYours(pad.name)}", "#1988 cancelled: make yours"],
]);

it("u477_app_has_no_raw_icon_only_buttons", () => {
  const unowned: string[] = [];

  for (const file of readdirSync("src", { recursive: true }).map(String).filter(file => file.endsWith(".tsx") && !/test|Fixture/.test(file)).sort()) {
    if (file === "ui/IconButton.tsx") continue;

    const source = readFileSync(`src/${file}`, "utf8");

    traverseFast(parse(source, { sourceType: "module", plugins: ["jsx", "typescript"] }), (node) => {
      if (!isJSXElement(node) || node.openingElement.name.type !== "JSXIdentifier" || node.openingElement.name.name !== "button") return;

      const attributes = node.openingElement.attributes;
      const label = attributes.find(attribute => attribute.type === "JSXAttribute" && attribute.name.name === "aria-label");
      const key = `${file}:${label?.type === "JSXAttribute" && label.value ? source.slice(label.value.start!, label.value.end!) : "unnamed"}`;
      const owner = rawIconOwners.get(key);
      const iconKind = attributes.some(attribute => attribute.type === "JSXAttribute" && attribute.name.name === "data-button" && attribute.value?.type === "StringLiteral" && attribute.value.value === "icon");
      const painted = node.children.filter(child => child.type !== "JSXText" || child.value.trim());
      const glyphsOnly = painted.length > 0 && painted.every(child => isJSXElement(child) && child.openingElement.name.type === "JSXIdentifier" && /Icon$|Mark$|Glyph$|^ListFilter$/.test(child.openingElement.name.name));

      if ((iconKind || glyphsOnly) && !owner) unowned.push(`${file}:${node.loc?.start.line} ${key}`);
    });
  }

  expect(unowned).toEqual([]);
});

it.each([["icon", "hover"], ["icon", "focus"], ["tip", "hover"], ["tip", "focus"]])("u2570b_unkeyed_tooltips_keep_their_content_%s_%s", async (wrapper, input) => {
  render(() => wrapper === "icon"
    ? <IconButton aria-label={copy.minimise}>−</IconButton>
    : <Tip text={copy.openFolder}>{(trigger) => <button {...trigger()} aria-label={copy.openFolder}>folder</button>}</Tip>);
  const button = screen.getByRole("button", { name: wrapper === "icon" ? copy.minimise : copy.openFolder });

  if (input === "hover") fireEvent.pointerMove(button, { pointerType: "mouse" });
  else { fireEvent.keyDown(document, { key: "Tab" }); button.focus(); }

  const tip = await screen.findByRole("tooltip");

  expect(tip.textContent).toBe(wrapper === "icon" ? copy.minimise : copy.openFolder);
  expect(tip.querySelector("kbd")).toBeNull();
  expect(button.getAttribute("aria-describedby")).toBe(tip.id);
});

it("u2570a_icon_button_forwards_its_chord_only_to_the_tooltip", async () => {
  render(() => <IconButton aria-label={copy.newAgent} chord={CHORDS[0]}>+</IconButton>);
  const button = screen.getByRole("button", { name: copy.newAgent });

  fireEvent.keyDown(document, { key: "Tab" });
  button.focus();
  const tip = await screen.findByRole("tooltip");

  expect([...tip.querySelectorAll("kbd")].map((key) => key.textContent).join("")).toBe(CHORDS[0]!.keys);
  expect(button.hasAttribute("chord")).toBe(false);
  expect(tip.hasAttribute("chord")).toBe(false);
});
