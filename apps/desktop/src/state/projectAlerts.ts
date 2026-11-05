import { createSignal } from "solid-js";
import * as v from "valibot";
import type { Kind } from "@contracts/Kind";
import { storageSchema, storedValue } from "./storage";

/** U6220d: what a Project's Agents may raise. `all` follows App Settings; `needs-you` narrows to `needs-you` and `error`; `off` raises nothing. */
export const PROJECT_ALERTS = ["all", "needs-you", "off"] as const;

export type ProjectAlerts = (typeof PROJECT_ALERTS)[number];

/** Whether a Kind may raise an Alert, a Sound or a Dock badge in a Project at this level; App Settings and the Agent's own level still apply on top. */
export const mayRaise = (level: ProjectAlerts, kind: Kind): boolean => level === "all" || (level === "needs-you" && (kind === "needs-you" || kind === "error"));

/** Only the Projects not at `all` are stored, by path. */
const schema = storageSchema("roundup:project-alerts", v.record(v.string(), v.picklist(["needs-you", "off"])));

export type ProjectAlertLevels = {
  level(path: string): ProjectAlerts;
  set(path: string, level: ProjectAlerts): void;
};

export const createProjectAlerts = (saved = storedValue("roundup:project-alerts", schema)): ProjectAlertLevels => {
  const [stored, setStored] = createSignal<Record<string, "needs-you" | "off">>(saved.read() ?? {});

  return {
    level: path => stored()[path] ?? "all",
    set: (path, level) => {
      const { [path]: _previous, ...rest } = stored();
      const next = level === "all" ? rest : { ...rest, [path]: level };

      setStored(next);
      void saved.write(next);
    },
  };
};
