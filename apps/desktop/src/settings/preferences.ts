import { createEffect, createRoot, createSignal, on, onCleanup, untrack } from "solid-js";
import * as v from "valibot";
import { storedValue } from "../state/storage";
import { DEFAULT_FONT_SIZE, MIN_FONT_SIZE, MAX_FONT_SIZE } from "../terminal/fontSize";
import type { AppSeam } from "../app/seam";

const schema = v.object({
  permissionMode: v.fallback(v.picklist(["", "default", "acceptEdits", "plan", "auto"]), ""),
  engine: v.fallback(v.string(), ""),
  model: v.fallback(v.string(), ""),
  engineLabel: v.fallback(v.string(), ""),
  modelLabel: v.fallback(v.string(), ""),
  fontFamily: v.fallback(v.string(), ""),
  fontSize: v.fallback(v.pipe(v.number(), v.minValue(MIN_FONT_SIZE), v.maxValue(MAX_FONT_SIZE)), DEFAULT_FONT_SIZE),
  quickAdd: v.fallback(v.pipe(v.string(), v.regex(/^(?=.*(?:meta|ctrl)\+)(?:ctrl\+)?(?:alt\+)?(?:meta\+)?(?:shift\+)?[A-Za-z][A-Za-z0-9]*$/)), "meta+shift+KeyT"),
  quickAddKey: v.fallback(v.string(), ""),
  mode: v.fallback(v.picklist(["dark", "light", "system"]), "system"),
});

type Preferences = v.InferOutput<typeof schema>;

const storage = () => storedValue("roundup:app-settings", schema);

const [revision, changed] = createSignal(0);

/** One app-wide record; each untrusted field defaults independently. A revision notifies all open Project tabs. */
export const appSettings = (): Preferences => {
  revision();

  return storage().read() ?? v.parse(schema, {});
};

/** A failed durable write changes nothing; the settings view shows the returned cause. */
export const saveAppSettings = (patch: Partial<Preferences>): string | null => {
  const failure = storage().write({ ...appSettings(), ...patch });

  if (failure === null) changed(value => value + 1);

  return failure;
};

/** Own the root's explicit scheme for this App lifetime. System continues using the native media query. */
export const applyAppAppearance = () => {
  createEffect(() => {
    const { mode } = appSettings();
    document.documentElement.dataset.mode = mode;

    if (mode === "system") document.documentElement.style.removeProperty("color-scheme");
    else document.documentElement.style.colorScheme = mode;
  });
  onCleanup(() => {
    delete document.documentElement.dataset.mode;
    document.documentElement.style.removeProperty("color-scheme");
  });
};

/** Only user launch calls receive App defaults. A saved Door resumes its own engine/model; only its permission default changes. */
export const withAppSettings = (app: AppSeam, resumesDoor: (id: string | number) => boolean): AppSeam => ({
  ...app,
  rpc: (method, params) => {
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

    if (method === "agent.resume" || method === "workstream.clear") {
      return app.rpc(method, Object.assign({}, params, permission));
    }

    return app.rpc(method, params);
  },
});

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
