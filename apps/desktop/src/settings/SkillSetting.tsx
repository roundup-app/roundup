import { createResource, createSignal, Show } from "solid-js";
import type { App } from "../app/seam";
import { copy } from "./copy";
import { Switch } from "../ui/Switch";

type Item = { item: string; state: string; path: string };

type Method = "skill.status" | "skill.setup" | "skill.remove";

const on = (items: Item[]) => items.length > 0 && items.every(i => i.state === "current" || i.state === "outdated");

/** SK10, SK11: the cause and the fix, in two lines, for the first item roundup cannot touch. */
const failureOf = (items: Item[]): [string, string] | null => {
  const refused = items.find(i => i.state === "foreign" || i.state === "unreadable" || i.state === "unsupported");

  if (!refused) return null;

  if (refused.state === "foreign") return [copy.skillForeignCause, copy.skillForeignFix];

  if (refused.state === "unreadable") return [copy.skillUnreadableCause(refused.path), copy.skillUnreadableFix];

  return [copy.skillUnsupportedCause, copy.skillUnsupportedFix];
};

const stateWords = (items: Item[]) => {
  if (items.some(i => i.state === "outdated")) return copy.skillOutdated;

  if (on(items)) return copy.skillCurrent;

  if (items.every(i => i.state === "missing")) return copy.skillMissing;

  return copy.skillPartial;
};

const none: Item[] = [];

/** SK10: the switch is the files' state; the App stores nothing and installs only when asked. */
export const SkillSetting = (props: { app: App }) => {
  const calls = props.app.forProject("");
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const read = async () => (await calls.rpc("skill.status", null)).items;

  const [items, { mutate }] = createResource(async () => {
    try { return await read(); }
    catch (cause) {
      if (!(cause instanceof Error)) throw cause;
      setError(cause.message);

      return none;
    }
  });

  const run = async (method: Exclude<Method, "skill.status">) => {
    if (busy()) return;
    setBusy(true);
    setError(null);

    try {
      await calls.rpc(method, null);
    } catch (cause) {
      if (!(cause instanceof Error)) throw cause;
      setError(cause.message);
    }

    try { mutate(await read()); }
    catch (cause) { if (!(cause instanceof Error)) throw cause; setError(current => current ?? cause.message); }
    finally { setBusy(false); }
  };

  const failure = (): [string, string] | null => {
    const message = error();

    return message ? [message, copy.skillWriteFix] : failureOf(items() ?? []);
  };

  return <Show when={items()}>{list => <>
    <Switch checked={on(list())} disabled={busy()} invalid={!!failure()} description={copy.skillHint}
      onCheckedChange={checked => void run(checked ? "skill.setup" : "skill.remove")}>{copy.skill}</Switch>
    <div class="settings-skill-state">
      <Show when={failure()} fallback={<span>{stateWords(list())}</span>}>{lines => <>
        <span>{lines()[0]}</span>
        <span>{lines()[1]}</span>
      </>}</Show>
      <Show when={list().some(i => i.state === "outdated")}>
        <button class="word" data-button="quiet" type="button" disabled={busy()} onClick={() => void run("skill.setup")}>{copy.skillUpdate}</button>
      </Show>
    </div>
  </>}</Show>;
};
