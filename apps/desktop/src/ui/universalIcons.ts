/** U7413a: icons whose meaning needs no name, so a hover tooltip on them shows only a key, never the name. The one list; callers name a role, never a copy of it. */
export const UNIVERSAL_ICONS = ["close", "stop", "delete", "copy", "more", "expand"] as const;

export type UniversalIcon = typeof UNIVERSAL_ICONS[number];

/** The name a tooltip shows: an explicit text, else the accessible name unless the icon is universal. */
export const tipName = (icon: UniversalIcon | undefined, tooltip: string | undefined, label: string | undefined): string | undefined =>
  tooltip ?? (icon ? undefined : label || undefined);
