import { readdirSync, readFileSync } from "node:fs";
import { parse } from "@babel/parser";
import { traverseFast, isJSXElement } from "@babel/types";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { u474Fixture } from "./u474Fixture";
import { CHORDS, ariaShortcut } from "../keys/chords";
import { saveAppSettings } from "../settings/preferences";
import { Tip } from "../ui/Tip";
import { copy } from "./copy";
import { IconButton } from "./IconButton";

afterEach(cleanup);

// u474_icon_button_requires_a_name: tsc checks both sides without mounting invalid UI.
const u474_icon_button_requires_a_name = () => {
  const named = <IconButton aria-label="Close Project">×</IconButton>;
  // @ts-expect-error An icon alone is not an accessible name.
  const unnamed = <IconButton>×</IconButton>;

  return [named, unnamed];
};

void u474_icon_button_requires_a_name;

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

  if (input === "hover") fireEvent.pointerLeave(button, { pointerType: "mouse" });
  else button.blur();

  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  expect(button.getAttribute("aria-describedby")).toBeNull();
});

it("u5247_icon_button_reads_its_key_by_name", async () => {
  render(() => <><IconButton aria-label="Maximise" action="shelf.maximise">+</IconButton><IconButton aria-label="Nothing" action="no.such">-</IconButton></>);
  const button = screen.getByRole("button", { name: "Maximise" });

  fireEvent.keyDown(document, { key: "Tab" });
  button.focus();
  const tip = await screen.findByRole("tooltip");

  expect([...tip.querySelectorAll("kbd")].map((key) => key.textContent).join("")).toBe("M");
  expect(button.getAttribute("aria-keyshortcuts")).toBe("M");
  expect(button.hasAttribute("action")).toBe(false);
  expect(screen.getByRole("button", { name: "Nothing" }).hasAttribute("aria-keyshortcuts")).toBe(false);
});

it("u5247_a_rebound_key_shows_everywhere", async () => {
  render(() => <IconButton aria-label="Capture" action="todo.capture">+</IconButton>);
  const button = screen.getByRole("button", { name: "Capture" });
  const chips = () => [...screen.getByRole("tooltip").querySelectorAll("kbd")].map((key) => key.textContent).join("");

  fireEvent.keyDown(document, { key: "Tab" });
  button.focus();
  await screen.findByRole("tooltip");
  const before = button.getAttribute("aria-keyshortcuts");
  await saveAppSettings({ quickAdd: "ctrl+shift+KeyY" });

  await waitFor(() => expect(button.getAttribute("aria-keyshortcuts")).toBe("Control+Shift+Y"));
  expect(before).not.toBe("Control+Shift+Y");
  expect(chips()).toBe(CHORDS.find((row) => row.name === "todo.capture")!.keys);
});

it("u5247a_every_named_icon_button_key_runs_its_action", () => {
  const names = ["shelf.maximise", "shelf.close", "todo.triage-enter", "agent.new"];

  render(() => <>{names.map((name) => <IconButton aria-label={name} action={name}>+</IconButton>)}</>);
  for (const name of names) {
    const row = CHORDS.find((chord) => chord.name === name)!;

    expect(screen.getByRole("button", { name }).getAttribute("aria-keyshortcuts")).toBe(ariaShortcut(row.keys));
  }
});

it("u477_icon_button_preserves_button_props", () => {
  render(u474Fixture);
  const button = screen.getByRole("button", { name: "Open Project" });

  expect(button.dataset.refConnected).toBe("true");
  expect(button.dataset.fixture).toBe("ordinary");
  expect(button.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(button);
  expect(Number(screen.getByLabelText("Actions taken").textContent)).toBe(1);
});

it("u477_icon_button_preserves_bound_click_handler", () => {
  render(u474Fixture);
  fireEvent.click(screen.getByRole("button", { name: "Bound action" }));
  expect(Number(screen.getByLabelText("Actions taken").textContent)).toBe(2);
});

it.each(["hover", "focus"])("u477_disabled_icon_button_shows_its_name_%s", async input => {
  render(u474Fixture);
  const button = screen.getByRole("button", { name: "Unavailable action" });

  if (input === "hover") fireEvent.pointerMove(button, { pointerType: "mouse" });
  else { fireEvent.keyDown(document, { key: "Tab" }); button.focus(); }

  const tip = await screen.findByRole("tooltip");

  expect(tip.textContent).toBe(button.getAttribute("aria-label"));
  expect(button.getAttribute("aria-describedby")).toBe(tip.id);

  if (input === "focus") expect(document.activeElement).toBe(button);
});

it("u477_disabled_icon_button_does_not_act", () => {
  render(u474Fixture);
  const button = screen.getByRole("button", { name: "Unavailable action" });

  for (const detail of [0, 1]) fireEvent.click(button, { detail });
  expect(Number(screen.getByLabelText("Actions taken").textContent)).toBe(0);
});
