/** App-authored settings copy (U471). Supplied values remain unchanged. */
import { copy as shared } from "../sharedCopy";

export const copy = {
  settings: shared.settings,
  settingsAgents: shared.settingsAgents,
  permissionAuto: shared.permissionAuto,
  storageRetry: shared.storageRetry,
  draftRetention: shared.draftRetention,
  close: shared.close,
  captureATodo: shared.captureATodo,
  model: "Model",
  reset: "Reset",
  settingsTerminal: shared.settingsTerminal,
  settingsShortcuts: "Shortcuts",
  settingsAppearance: "Appearance",
  permissionMode: "Permission mode",
  permissionDefault: "Claude Code default",
  permissionNormal: "Default",
  permissionEdits: "Accept edits",
  permissionPlan: "Plan",
  engine: "Engine",
  modelDefault: "Use the default",
  fontFamily: "Font family",
  fontSize: "Font size",
  /** @prose */
  fontSizeRefusal: (min: number, max: number) => `Choose a font size from ${min} to ${max}.`,
  quickAddTodo: "Quick Todo",
  recordShortcut: "Press a shortcut",
  /** @prose */
  shortcutRefusal: (chord: string, action: string) => `${chord} is already ${action}. Choose another shortcut.`,
  /** @prose */
  shortcutModifier: "Use one key with ⌘ or ⌃.",
  quitApp: "Quit roundup",
  hideApp: "Hide roundup",
  spotlight: "Spotlight",
  switchApps: "Switch apps",
  mode: "Mode",
  modeDark: "Dark",
  modeLight: "Light",
  modeSystem: "System",
} as const;
