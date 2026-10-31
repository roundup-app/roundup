import * as v from "valibot";
import { ACTION_ROWS } from "./chords";
import type { ActionArg, ActionValue, ActionValues } from "./chords";
import { copy } from "./copy";
import { captureEvery, leaderArmed, modalOpen } from "./registry";
import type { CapturedAction } from "./registry";

/** NA5: one row of the list. */
export type ActionRow = { name: string; label: string; keys: string; args: readonly ActionArg[]; available: boolean; cause: string | undefined };

export type RefusalCode = "unknown-action" | "unknown-argument" | "missing-argument" | "invalid-argument" | "repeated-argument" | "unavailable";

/** NA3: `awaiting` means the action opened a confirm, a prompt or the leader's wait for the user to finish. A refusal runs nothing and says what to do next. */
export type ActionResult = { status: "done" } | { status: "awaiting" } | { status: "refused"; code: RefusalCode; message: string };

const refuse = (code: RefusalCode, message: string): ActionResult => ({ status: "refused", code, message });

const schemaOf = (arg: ActionArg) => {
  switch (arg.type) {
    case "string": return v.string();
    case "boolean": return v.pipe(v.picklist(["true", "false"]), v.transform(text => text === "true"));
    case "choice": {
      // SAFETY: a choice declares at least one option.
      const options = arg.options as [string, ...string[]];

      return v.picklist(options);
    }
    case "integer": return v.pipe(v.string(), v.regex(/^-?\d+$/), v.transform(Number), v.minValue(arg.min), v.maxValue(arg.max));
  }
};

const describe = (arg: ActionArg) => `${arg.key}=${arg.type === "integer" ? `${arg.min}–${arg.max}` : arg.type === "choice" ? arg.options.join("|") : arg.type}`;

const causeOf = (row: (typeof ACTION_ROWS)[number]) => modalOpen() ? copy.actionCauseDialog : "inRail" in row && row.inRail ? copy.actionCauseRail : copy.actionCauseFocus;

const bindingsOf = (name: string, focus: Element | null): CapturedAction[] => captureEvery(focus).filter(row => row.name === name);

/** NA5: each named action once, in Help's order, with its keys as Help shows them now, and whether a key would run it for `focus`. */
export const listActions = (focus: Element | null = document.activeElement): ActionRow[] => {
  const open = modalOpen();

  return ACTION_ROWS.map(row => {
    const available = !open && bindingsOf(row.name, focus).some(binding => binding.available());

    return {
      name: row.name, label: row.what,
      keys: "press" in row ? `${ACTION_ROWS.find(chord => chord.name === "leader.open")!.keys} ${row.keys}` : row.keys,
      args: row.args ?? [], available, cause: available ? undefined : causeOf(row),
    };
  });
};

/** NA3, NA4: run `name` with its `key=value` pairs once, through the owner a key would reach; refuse a call a key could not make. No key event is dispatched. */
export const runAction = (name: string, pairs: readonly (readonly [string, string])[] = [], focus: Element | null = document.activeElement): ActionResult => {
  const row = ACTION_ROWS.find(each => each.name === name);

  if (!row) return refuse("unknown-action", copy.actionUnknown(name));

  const declared = row.args ?? [];
  const given = new Map<string, string>();

  for (const [key, text] of pairs) {
    if (!declared.some(arg => arg.key === key)) return refuse("unknown-argument", copy.actionNoArgument(name, key, declared.map(describe).join(", ")));

    if (given.has(key)) return refuse("repeated-argument", copy.actionRepeated(key));

    given.set(key, text);
  }

  const values: Record<string, ActionValue> = {};

  for (const arg of declared) {
    const text = given.get(arg.key);

    if (text === undefined) {
      if (arg.required) return refuse("missing-argument", copy.actionMissing(name, describe(arg)));
      continue;
    }

    const parsed = v.safeParse(schemaOf(arg), text);

    if (!parsed.success) return refuse("invalid-argument", copy.actionInvalid(arg.key, describe(arg)));

    values[arg.key] = parsed.output;
  }

  const wanted = declared.flatMap(arg => arg.press && arg.key in values ? [arg.press(values[arg.key]!)] : [])[0];
  const target = bindingsOf(name, focus).find(binding => (wanted === undefined || binding.press === wanted) && !modalOpen() && binding.available());

  if (!target) return refuse("unavailable", copy.actionUnavailable(name, causeOf(row)));

  // SAFETY: `values` holds only parsed values of the declared arguments.
  target.run(values as ActionValues);

  return { status: modalOpen() || leaderArmed() ? "awaiting" : "done" };
};
