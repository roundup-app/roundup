import type { ComponentProps } from "solid-js";
import type { Icon } from "./Icon";

type IconName = ComponentProps<typeof Icon>["name"];

/** U5215: the one place a component names the icon of a created kind; the Rail sections, footer buttons, menus, `⌘K` entries and Help read it. */
export const KIND_ICON = { workstream: "messages", mode: "workflow", agent: "bot" } as const satisfies Record<string, IconName>;
