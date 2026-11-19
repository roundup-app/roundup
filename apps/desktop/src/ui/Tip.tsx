import { createSignal, merge, omit } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { Chord } from "../keys/chords";
import { saveAppSettings, storedSettings } from "../settings/preferences";
import { storageProblems } from "../state/storage";
import { Tooltip } from "./Tooltip";

/** The props a control spreads: its own, and the Tooltip trigger's. */
export type TriggerProps = Omit<JSX.ButtonHTMLAttributes<HTMLElement>, "ref" | "children">;

/** What a control adds to the trigger: its own props, and a `ref` the trigger keeps beside its own. */
export type OwnTriggerProps = TriggerProps & { ref?: JSX.Ref<HTMLElement> };

export type Trigger = (own?: OwnTriggerProps) => TriggerProps;

type Handler = JSX.EventHandlerUnion<HTMLElement, Event>;

type Fired = Parameters<JSX.EventHandler<HTMLElement, Event>>[0];

const FOCUS_PROPS = new Set<PropertyKey>(["onFocusIn", "onFocusOut", "aria-describedby"]);

const focusProps = (trigger: TriggerProps) => omit(trigger, key => !FOCUS_PROPS.has(key));

const run = (handler: Handler, event: Fired) => {
  if ("0" in handler) handler[0](handler[1], event);
  else handler(event);
};

/** The control's own handlers run before the Tooltip trigger's, so a press it handles can still close the tooltip. */
const withOwn = (trigger: OwnTriggerProps, own: OwnTriggerProps): TriggerProps => {
  const theirs = new Map<string, Handler>(Object.entries(trigger));

  const chained: Record<`on${string}`, (event: Fired) => void> = Object.fromEntries(Object.entries(own).flatMap(([key, handler]) => {
    const other = theirs.get(key);

    return /^on[A-Z]/.test(key) && other ? [[key, (event: Fired) => { run(handler, event); run(other, event); }]] : [];
  }));

  return merge(trigger, own, chained, { ref: trigger.ref && own.ref ? [trigger.ref, own.ref] : trigger.ref ?? own.ref });
};

/** U7650a: under Show once, a fixed tooltip opens this many times per icon name, then never again. */
export const TIP_SHOWS = 1;

/** Counts written but not yet read back from storage, so two quick openings both count. */
const pending: Record<string, number> = {};

const shown = (name: string): number => Math.max(storedSettings().tipShows[name] ?? 0, pending[name] ?? 0);

/** A count never joins a settings save that is failing: the store keeps one retry per key, and a count's write would replace the user's. */
const countShow = (name: string) => {
  if (storageProblems().some(problem => problem.key === "roundup:app-settings")) return Promise.resolve(null);

  const next = shown(name) + 1;

  pending[name] = next;

  return saveAppSettings({ tipShows: { ...storedSettings().tipShows, ...pending } }).finally(() => { if (pending[name] === next) delete pending[name]; });
};

/** U7650a: choose Hide, Show once or Always show; Show once starts every icon's count fresh. */
export const chooseIconNames = (iconNames: "hide" | "once" | "always"): Promise<string | null> => {
  for (const name of Object.keys(pending)) delete pending[name];

  return saveAppSettings(iconNames === "once" ? { iconNames, tipShows: {} } : { iconNames });
};

/** U7489b: whether a tooltip's text is fixed for its icon (a `name`, which counts its shows) or changes with state. Every caller sets one. */
export type TipKind = { kind: "changing" } | { kind: "fixed"; name: string };

/** Put the trigger on the smallest element owning the text. Pointer openings assert containment in development and tests. The second children argument carries focus handlers for an enclosing keyboard control. Keyboard focus needs no pointer. */
export const Tip = (props: TipKind & {
  text?: string | undefined;
  content?: JSX.Element;
  cut?: () => boolean;
  class?: string;
  chord?: Chord | undefined;
  disabled?: boolean;
  children: (trigger: Trigger, focus: Pick<TriggerProps, "onFocusIn" | "onFocusOut" | "aria-describedby">) => JSX.Element;
}) => {
  const [open, setOpen] = createSignal(false);

  const retired = () => {
    if (props.kind !== "fixed") return false;

    const choice = storedSettings().iconNames;

    return choice === "hide" || (choice === "once" && !!props.name && !open() && shown(props.name) >= TIP_SHOWS);
  };

  const changed = ({ open: now }: { open: boolean }) => {
    if (now && !open() && props.kind === "fixed" && props.name && storedSettings().iconNames === "once") void countShow(props.name);
    setOpen(now);
  };

  return (
  <Tooltip.Root disabled={props.disabled || retired() || (props.cut ? !props.cut() : false)} delay={200} onOpenChange={changed}>
    <Tooltip.Trigger render={rendered => {
      const trigger: OwnTriggerProps = omit(rendered, "class", "style", "children");

      return props.children(own => own ? withOwn(trigger, own) : trigger, merge(focusProps(trigger), { onFocusIn: Tooltip.useEnclosingFocusIn() }));
    }} />
    <Tooltip.Content side="right" align="start" class={props.class ?? (props.content !== undefined ? "ink-tip" : undefined)} chord={props.chord}>{props.content ?? props.text}</Tooltip.Content>
  </Tooltip.Root>
  );
};
