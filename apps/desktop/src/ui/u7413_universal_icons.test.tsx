import { readdirSync, readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { For } from "solid-js";
import { afterEach, expect, it } from "vitest";
import { TAB_CLOSE } from "../keys/chords";
import { BusyButton } from "./BusyButton";
import { ExitButton, IconButton } from "./IconButton";
import { UNIVERSAL_ICONS } from "./universalIcons";

afterEach(cleanup);

const hover = (button: HTMLElement) => fireEvent.pointerEnter(button, { pointerType: "mouse" });

const focus = (button: HTMLElement) => { fireEvent.keyDown(document, { key: "Tab" }); button.focus(); };

const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const path = `${dir}/${entry.name}`;

  return entry.isDirectory() ? (entry.name === "node_modules" ? [] : sources(path)) : entry.name.endsWith(".tsx") && !/\.test\.|Fixture/.test(entry.name) ? [path] : [];
});

it.each(["hover", "focus"] as const)("u7413a_universal_icons_show_no_tooltip_%s", async input => {
  render(() => <>
    <For each={UNIVERSAL_ICONS}>{icon => <IconButton icon={icon} aria-label={`Name of ${icon}`}>+</IconButton>}</For>
    <BusyButton kind="icon" icon="delete" busyLabel="Deleting…" aria-label="Name of busy">+</BusyButton>
    <ExitButton />
  </>);

  for (const button of screen.getAllByRole("button")) {
    (input === "hover" ? hover : focus)(button);
    await new Promise(done => setTimeout(done, 300));
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(button.getAttribute("aria-label")).toBeTruthy();
    button.blur();
  }
});

it("u7413a_other_icons_show_their_name", async () => {
  render(() => <><IconButton aria-label="Reply">+</IconButton><BusyButton kind="icon" busyLabel="Sending…" aria-label="Send">+</BusyButton></>);

  for (const name of ["Reply", "Send"]) {
    const button = screen.getByRole("button", { name });

    hover(button);
    expect((await screen.findByRole("tooltip")).textContent).toBe(name);
    fireEvent.pointerLeave(button, { pointerType: "mouse", clientX: 900, clientY: 900 });
    await new Promise(done => setTimeout(done, 50));
  }
});

it("u7413a_a_shortcut_shows_alone_on_a_universal_icon", async () => {
  render(() => <><IconButton icon="close" chord={TAB_CLOSE} aria-label="Close Project A">×</IconButton><IconButton aria-label="Maximise" action="shelf.maximise">+</IconButton></>);
  focus(screen.getByRole("button", { name: "Close Project A" }));
  const tip = await screen.findByRole("tooltip");

  expect(tip.textContent?.trim()).toBe(TAB_CLOSE.keys);
});

it("u7413b_each_screen_icon_button_follows_the_tooltip_rule", () => {
  const roles = {
    "header/ProjectTab.tsx": ['icon="close"'],
    "rail/RowIcons.tsx": ['"stop"', '"more"'],
    "rail/RailRow.tsx": ['icon="expand"'],
    "drawer/DrawerHost.tsx": ['icon="close"'],
    "pads/PadContent.tsx": ['icon="delete"'],
    "todos/Todos.tsx": ['icon="expand"'],
    "todos/TodoHeader.tsx": ['icon="more"'],
    "todos/TodoRefs.tsx": ['icon="delete"'],
    "ui/CopyButton.tsx": ['"copy"'],
    "bubbles/tab.tsx": ['icon="close"'],
    "window/Layout.tsx": ['icon="close"'],
  };

  for (const [file, marks] of Object.entries(roles)) {
    const text = readFileSync(`${__dirname}/../${file}`, "utf8");

    for (const mark of marks) expect(text, `${file} ${mark}`).toContain(mark);
  }
});

/** One row per occurrence: a JSX opening tag passing both a universal `icon` and a `tooltip`. */
const offenders = (files: Record<string, string>) => Object.entries(files).flatMap(([file, text]) =>
  [...text.matchAll(/<(?:IconButton|BusyButton|Tip)\b[^>]*?>/gs)].flatMap(tag => /\bicon=/.test(tag[0]) && /\b(tooltip|text)=/.test(tag[0]) ? [file] : []));

it("u7413c_a_universal_icon_with_a_name_tooltip_fails", () => {
  const files = Object.fromEntries(sources(`${__dirname}/..`).filter(file => !file.endsWith("ui/universalIcons.ts")).map(file => [file, readFileSync(file, "utf8")]));

  expect(offenders(files)).toEqual([]);
  expect(offenders({ "x.tsx": '<IconButton icon="close" tooltip="Close" aria-label="Close">x</IconButton>' })).toEqual(["x.tsx"]);
});
