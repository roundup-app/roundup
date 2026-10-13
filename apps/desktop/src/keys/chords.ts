/** One line of Help (U54): the chord as shown, what it does, and every key press it stands for as `<mods>+<code>`, mods in the order `ctrl+alt+meta+shift`. `inRail` marks a chord only a focused Rail row binds (U358); the rest bind from the pane too. */
export type Chord = { keys: string; what: string; presses: readonly string[]; inRail?: true };

const digits = (from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, offset) => `alt+Digit${from + offset}`);

/** Every chord bound in the webview outside a Terminal screen, in Help's order (U54; U106 and U107 follow the scenario's list). `⌘K` joins when U51 binds it. The Terminal's own `⌘C`, `⌘V`, `⌘=`, `⌘-` and `⌘0` act only in a Terminal screen, where `?` never opens Help. */
export const CHORDS: readonly Chord[] = [
  { keys: "⌘J", what: "Jump to what needs you", presses: ["meta+KeyJ"] },
  { keys: "⌘N", what: "New Agent", presses: ["meta+KeyN"] },
  { keys: "⇧⌘N", what: "New Agent with a prompt", presses: ["meta+shift+KeyN"] },
  { keys: "⌘T", what: "New Terminal", presses: ["meta+KeyT"] },
  { keys: "⌘B", what: "Next Bubble", presses: ["meta+KeyB", "meta+shift+KeyB"] },
  { keys: "⌘.", what: "Minimise or restore the Bubble", presses: ["meta+Period"] },
  { keys: "⇧⌘⌫", what: "Close the Bubble", presses: ["meta+shift+Backspace"] },
  { keys: "⌘1", what: "Focus the Rail", presses: ["meta+Digit1"] },
  { keys: "⌘2", what: "Focus the pane", presses: ["meta+Digit2"] },
  { keys: "⌘⌫", what: "Remove", presses: ["meta+Backspace"], inRail: true },
  { keys: "⌃O", what: "Expand or fold the Thread", presses: ["ctrl+KeyO"] },
  { keys: "⌥1–⌥9", what: "Take over the n-th Agent", presses: digits(1, 9) },
  { keys: "⌥0", what: "End the Takeover", presses: digits(0, 0) },
  { keys: "⇧⌘J", what: "Jump to what needs you in another Project", presses: ["meta+shift+KeyJ"] },
  { keys: "⌘\\", what: "Show or hide the Shelf", presses: ["meta+Backslash"] },
  { keys: "⌘,", what: "Models", presses: ["meta+Comma"] },
  { keys: "⇧⌘]", what: "Next Project", presses: ["meta+shift+BracketRight"] },
  { keys: "⇧⌘[", what: "Previous Project", presses: ["meta+shift+BracketLeft"] },
];

/** The `<mods>+<code>` of a key press, as `Chord.presses` writes it. */
export const pressOf = (press: Pick<KeyboardEvent, "ctrlKey" | "altKey" | "metaKey" | "shiftKey" | "code">): string =>
  [press.ctrlKey && "ctrl", press.altKey && "alt", press.metaKey && "meta", press.shiftKey && "shift", press.code].filter(Boolean).join("+");
