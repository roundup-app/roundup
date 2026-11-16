import type { Updates } from "../state/updates";
import { copy } from "./copy";

/** One control the Settings search can find: where it lives, and the words that match it. */
export type Entry = {
  id: string;
  page: string;
  group: string;
  label: string;
  description: string;
  hiddenHint?: boolean;
  when?: () => boolean;
};

/** What decides which entries are live: the open Project, the App's update facts (U7208a) and the terminal's numeric fields. */
type Live = {
  project: () => string | null;
  updates: Updates;
  numericFields: readonly { name: string; label: string; hint: string }[];
};

/** U5243a: every control the search ranks, whether its page is showing or not. */
export const settingsEntries = ({
  project,
  updates,
  numericFields,
}: Live): Entry[] => {
  const all: Entry[] = [
    {
      id: "permission",
      page: copy.settingsAgents,
      group: copy.groupPermissions,
      label: copy.permissionMode,
      description: copy.permissionHint,
    },
    {
      id: "engine",
      page: copy.settingsAgents,
      group: copy.groupEngine,
      label: copy.engine,
      description: copy.engineHint,
      when: () => !!project(),
    },
    {
      id: "model",
      page: copy.settingsAgents,
      group: copy.groupEngine,
      label: copy.model,
      description: copy.modelHint,
      when: () => !!project(),
    },
    {
      id: "naming",
      page: copy.settingsAgents,
      group: copy.groupNaming,
      label: copy.automaticRenaming,
      description: copy.automaticRenamingHint,
      hiddenHint: true,
    },
    {
      id: "skill",
      page: copy.settingsAgents,
      group: copy.groupSkill,
      label: copy.skill,
      description: copy.skillHint,
      hiddenHint: true,
    },
    {
      id: "fontFamily",
      page: copy.settingsTerminal,
      group: copy.groupFont,
      label: copy.fontFamily,
      description: copy.fontFamilyHint,
    },
    {
      id: "fontWeight",
      page: copy.settingsTerminal,
      group: copy.groupFont,
      label: copy.fontWeight,
      description: copy.fontWeightHint,
    },
    ...numericFields.map(({ name, label, hint }) => ({
      id: name,
      page: copy.settingsTerminal,
      group: copy.groupFont,
      label,
      description: hint,
    })),
    {
      id: "codeEditor",
      page: copy.settingsEditor,
      group: copy.settingsEditor,
      label: copy.codeEditor,
      description: copy.codeEditorHint,
    },
    {
      id: "quickAdd",
      page: copy.settingsShortcuts,
      group: copy.groupQuickAdd,
      label: copy.quickAddTodo,
      description: copy.quickAddHint,
    },
    {
      id: "quickAddAnywhere",
      page: copy.settingsShortcuts,
      group: copy.groupQuickAdd,
      label: copy.quickAddAnywhere,
      description: copy.quickAddAnywhereHint,
    },
    {
      id: "padWidth",
      page: copy.settingsPads,
      group: copy.settingsPads,
      label: copy.defaultWidth,
      description: copy.defaultWidthHint,
    },
    {
      id: "mode",
      page: copy.settingsAppearance,
      group: copy.groupTheme,
      label: copy.settingsAppearance,
      description: copy.modeHint,
    },
    {
      id: "interfaceScale",
      page: copy.settingsAppearance,
      group: copy.groupTheme,
      label: copy.interfaceScale,
      description: copy.interfaceScaleHint,
    },
    {
      id: "updateRoundup",
      page: copy.settingsUpdates,
      group: copy.settingsUpdates,
      label: copy.roundup,
      description: copy.updateRoundupHint,
      when: () => !!updates.facts()?.roundup,
    },
    {
      id: "updateCore",
      page: copy.settingsUpdates,
      group: copy.settingsUpdates,
      label: copy.herdrCore,
      description: copy.updateCoreHint,
      when: () => updates.facts() !== null,
    },
    {
      id: "focusMarkers",
      page: copy.settingsAppearance,
      group: copy.groupFocus,
      label: copy.focusMarkers,
      description: copy.focusMarkersHint,
      hiddenHint: true,
    },
  ];

  return all.filter((entry) => entry.when?.() ?? true);
};
