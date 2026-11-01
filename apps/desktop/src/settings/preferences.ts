import { createEffect, createRoot, createSignal, on, onCleanup, untrack } from "solid-js";
import * as v from "valibot";
import tokens from "../tokens.css?inline";
import { storageSchema, storedValue } from "../state/storage";
import { DEFAULT_FONT_SIZE, MIN_FONT_SIZE, MAX_FONT_SIZE } from "../terminal/fontSize";
import type { CapturePort, AppSeam } from "../app/seam";

const tokenNumber = (name: string) => Number.parseFloat(new RegExp(`--${name}:\\s*([^;]+);`).exec(tokens)![1]!);

/** Inclusive xterm ranges shared by the stored parser and numeric editors. */
export const terminalRanges = {
  fontSize: { min: MIN_FONT_SIZE, max: MAX_FONT_SIZE, step: 1 },
  lineHeight: { min: tokenNumber("line-terminal-min"), max: tokenNumber("line-terminal-max"), step: tokenNumber("terminal-type-step") },
  letterSpacing: { min: tokenNumber("letter-terminal-min"), max: tokenNumber("letter-terminal-max"), step: tokenNumber("terminal-type-step") },
} as const;

// U5232a: the Dock badge and the sound are on for needs-you and error, every alert is off; each choice falls back alone.
const rowDefault = (on: boolean) => ({ alert: false, sound: on, badge: on });

const stateRow = (on: boolean) => v.fallback(
  v.object({ alert: v.fallback(v.boolean(), false), sound: v.fallback(v.boolean(), on), badge: v.fallback(v.boolean(), on) }),
  rowDefault(on),
);

const schema = storageSchema("roundup:app-settings", v.object({
  permissionMode: v.fallback(v.picklist(["", "default", "acceptEdits", "plan", "auto"]), ""),
  engine: v.fallback(v.string(), ""),
  model: v.fallback(v.string(), ""),
  engineLabel: v.fallback(v.string(), ""),
  modelLabel: v.fallback(v.string(), ""),
  fontFamily: v.fallback(v.string(), ""),
  fontSize: v.fallback(v.pipe(v.number(), v.minValue(MIN_FONT_SIZE), v.maxValue(MAX_FONT_SIZE)), DEFAULT_FONT_SIZE),
  lineHeight: v.fallback(v.pipe(v.number(), v.minValue(terminalRanges.lineHeight.min), v.maxValue(terminalRanges.lineHeight.max)), tokenNumber("line-terminal")),
  letterSpacing: v.fallback(v.pipe(v.number(), v.minValue(terminalRanges.letterSpacing.min), v.maxValue(terminalRanges.letterSpacing.max)), tokenNumber("letter-terminal")),
  fontWeight: v.fallback(v.pipe(v.number(), v.check(value => [300, 400, 500, 600].includes(value))), tokenNumber("weight-terminal")),
  interfaceScale: v.fallback(v.picklist(["small", "default", "large"]), "default"),
  focusMarkers: v.fallback(v.boolean(), true),
  quickAdd: v.fallback(v.pipe(v.string(), v.regex(/^(?=.*(?:meta|ctrl)\+)(?:ctrl\+)?(?:alt\+)?(?:meta\+)?(?:shift\+)?[A-Za-z][A-Za-z0-9]*$/)), "meta+shift+KeyT"),
  quickAddKey: v.fallback(v.string(), ""),
  // Mac-wide quick add: "" is none, and none registers no global shortcut.
  quickAddAnywhere: v.fallback(v.pipe(v.string(), v.regex(/^(?:(?=.*(?:meta|ctrl)\+)(?:ctrl\+)?(?:alt\+)?(?:meta\+)?(?:shift\+)?[A-Za-z][A-Za-z0-9]*)?$/)), ""),
  quickAddAnywhereKey: v.fallback(v.string(), ""),
  // U5239b: a saved press per action `name`; an entry that is not a press is dropped.
  shortcuts: v.fallback(v.record(v.string(), v.pipe(v.string(), v.regex(/^(?=.*(?:meta|ctrl)\+)(?:ctrl\+)?(?:alt\+)?(?:meta\+)?(?:shift\+)?[A-Za-z][A-Za-z0-9]*$/))), {}),
  mode: v.fallback(v.picklist(["dark", "light", "system"]), "system"),
  stateAlerts: v.fallback(
    v.object({ working: stateRow(false), blocked: stateRow(false), "needs-you": stateRow(true), error: stateRow(true), done: stateRow(false) }),
    { working: rowDefault(false), blocked: rowDefault(false), "needs-you": rowDefault(true), error: rowDefault(true), done: rowDefault(false) },
  ),
}));

type Preferences = v.InferOutput<typeof schema>;

/** The Kinds with choices (U5232), in Settings order, and the three choices each holds. */
export const alertStates = ["working", "blocked", "needs-you", "error", "done"] as const;

export const alertChoices = ["alert", "sound", "badge"] as const;

const [revision, changed] = createSignal(0);

const storage = () => storedValue("roundup:app-settings", schema, () => changed(value => value + 1));

/** One app-wide record; each untrusted field defaults independently. A revision notifies all open Project tabs. */
export const appSettings = (): Preferences => {
  revision();

  return storage().read() ?? v.parse(schema, {});
};

/** Preview and real emulators resolve the same saved typography; Project zoom overrides size separately. */
export const terminalType = (settings = appSettings()) => ({
  fontFamily: settings.fontFamily || /--font-terminal:\s*([^;]+);/.exec(tokens)![1]!.trim(),
  fontSize: settings.fontSize,
  fontWeight: settings.fontWeight,
  lineHeight: settings.lineHeight,
  letterSpacing: settings.letterSpacing,
});

/** A failed durable write changes nothing; the settings view shows the returned cause. */
let saving: Promise<unknown> = Promise.resolve();

export const saveAppSettings = (patch: Partial<Preferences>, capture?: CapturePort): Promise<string | null> => {
  const captured = structuredClone(patch);

  const pending = saving.then(async () => {
    const before = appSettings();
    const replacement = captured.quickAddAnywhere !== undefined && captured.quickAddAnywhere !== before.quickAddAnywhere;

    try {
      if (replacement && capture) await capture.configure(captured.quickAddAnywhere! || null);
      const failure = await storage().write({ ...before, ...captured });

      if (failure && replacement && capture) await capture.configure(before.quickAddAnywhere || null);

      return failure;
    } catch (error) {
      return String(error);
    }
  });

  saving = pending;

  return pending;
};

/** Own the root's explicit scheme for this App lifetime. System continues using the native media query. */
export const applyAppAppearance = () => {
  createEffect(() => {
    const { mode, interfaceScale, focusMarkers } = appSettings();
    document.documentElement.dataset.interfaceScale = interfaceScale;
    document.documentElement.dataset.focusMarkers = String(focusMarkers);
    document.documentElement.dataset.mode = mode;

    if (mode === "system") document.documentElement.style.removeProperty("color-scheme");
    else document.documentElement.style.colorScheme = mode;
  });
  onCleanup(() => {
    delete document.documentElement.dataset.mode;
    delete document.documentElement.dataset.interfaceScale;
    delete document.documentElement.dataset.focusMarkers;
    document.documentElement.style.removeProperty("color-scheme");
  });
};

/** Only user launch calls receive App defaults. A saved Door resumes its own engine/model; only its permission default changes. */
export const withAppSettings = (app: AppSeam, resumesDoor: (id: string | number) => boolean): AppSeam => {
  const rpc: AppSeam["rpc"] = (method, params) => {
    const settings = untrack(appSettings);

    const normal = !(params && "mode" in params && params.mode === "yolo");
    const permission = normal && settings.permissionMode ? { permissionMode: settings.permissionMode } : {};

    if (method === "rail.startDoor" && params && "id" in params && resumesDoor(params.id)) {
      return app.rpc(method, Object.assign({}, params, permission));
    }

    if (method === "agent.spawn" || method === "rail.startDoor") {
      return app.rpc(method, Object.assign({}, params,
        settings.engine ? { engine: settings.engine } : {},
        settings.model && !(params && "model" in params && params.model) ? { model: settings.model } : {},
        permission,
      ));
    }

    if (method === "agent.resume") {
      return app.rpc(method, Object.assign({}, params, permission));
    }

    return app.rpc(method, params);
  };

  return {
    ...app,
    rpc,
    // The native menu responder can change after connecting a Project; read it when invoked.
    get showContextMenu() { return app.showContextMenu; },
  };
};

const DARK_SCHEME = "(prefers-color-scheme: dark)";

/** An explicit App choice overrides macOS; System reads the native media query each time. */
export const appDark = (): boolean => {
  const mode = appSettings().mode;

  return mode === "system" ? (window.matchMedia?.(DARK_SCHEME).matches ?? false) : mode === "dark";
};

/** Follow App and macOS choices; consumers apply their initial theme and release this watch when unmounted. */
export const followAppAppearance = (changed: () => void): (() => void) => {
  const query = window.matchMedia?.(DARK_SCHEME);

  const dispose = createRoot(dispose => {
    createEffect(on(() => appSettings().mode, changed, { defer: true }));

    return dispose;
  });

  const follow = () => { if (appSettings().mode === "system") changed(); };

  query?.addEventListener("change", follow);

  return () => { dispose(); query?.removeEventListener("change", follow); };
};
