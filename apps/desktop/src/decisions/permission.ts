import * as v from "valibot";
import type { Decision } from "@contracts/decision/Decision";
import type { Scope } from "@contracts/decision/Scope";

const json = v.pipe(v.string(), v.parseJson());

const text = v.optional(v.string());

const edit = v.looseObject({ old_string: text, new_string: text, content: text, new_source: text });

const toolInput = v.pipe(json, v.looseObject({ command: text, description: text, file_path: text, notebook_path: text, edits: v.optional(v.array(edit)), old_string: text, new_string: text, content: text, new_source: text }));

type Edit = v.InferOutput<typeof edit>;

const lines = (value: string | undefined): number => value ? value.split("\n").length - (value.endsWith("\n") ? 1 : 0) : 0;

export type Effect = { path: string; added: number; removed: number };

export type Reading = {
  /** What the tool does, for the title: `run` for a command, `edit` for an `Edit`, else `use`. */
  verb: "run" | "edit" | "use";
  /** The command or path, else the tool name: also what a folded line names. */
  target: string;
  /** The payload's own `description`; never invented. */
  reason: string | null;
  /** U3794: files an `Edit` or `Write` changes, with their `+n −m` counts. */
  effects: Effect[];
  /** The arguments to print when the title does not hold them (U113). */
  rest: string | null;
};

/** U3794: a permission Decision's `args` read as who runs what and what changes. Unreadable (cut) arguments name only the tool. */
export const readPermission = (decision: Pick<Decision, "tool" | "args">): Reading => {
  const parsed = v.safeParse(toolInput, decision.args);
  const args = parsed.success ? parsed.output : null;
  const reason = args?.description || null;
  const path = args?.file_path || args?.notebook_path || null;

  if (args?.command && decision.tool === "Bash") return { verb: "run", target: args.command, reason, effects: [], rest: null };

  if (args && path && ["Edit", "MultiEdit", "Write", "NotebookEdit"].includes(decision.tool)) {
    const edits: Edit[] = args.edits ?? [args];
    const effect = { path, added: 0, removed: 0 };

    for (const each of edits) {
      effect.added += lines(each.new_string ?? each.content ?? each.new_source);
      effect.removed += lines(each.old_string);
    }

    return { verb: decision.tool === "Edit" ? "edit" : "use", target: decision.tool === "Edit" ? path : decision.tool, reason, effects: [effect], rest: null };
  }

  return { verb: "use", target: decision.tool, reason, effects: [], rest: args ? JSON.stringify(args, null, 2) : decision.args };
};

export const SCOPES: readonly Scope[] = ["once", "session", "project"];
