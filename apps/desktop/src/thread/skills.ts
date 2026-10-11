import type { Skill } from "@contracts/agent/Skill";

/** P9: commands the Thread never offers, though the Daemon already leaves them out (A31). */
const BANNED = new Set(["model", "effort", "compact", "clear"]);

/** U198: what follows a `/` that starts the value, or null once the value is not a name being typed. */
export const slashQuery = (value: string): string | null => (value.startsWith("/") && !/\s/.test(value) ? value.slice(1) : null);

/** U198: the Skills whose name holds `query`, case-insensitive: prefix matches first, then substring matches, each in the Daemon's order. */
export const matching = (skills: readonly Skill[], query: string): Skill[] => {
  const wanted = query.toLowerCase();
  const offered = skills.filter((skill) => !BANNED.has(skill.name.split(":").pop() ?? skill.name));
  const prefixed = offered.filter((skill) => skill.name.toLowerCase().startsWith(wanted));
  const inside = offered.filter((skill) => !skill.name.toLowerCase().startsWith(wanted) && skill.name.toLowerCase().includes(wanted));

  return [...prefixed, ...inside];
};
