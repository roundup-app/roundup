import { createEffect, createRoot, createSignal, on, onCleanup, untrack } from "solid-js";
import * as v from "valibot";
import { storageSchema, storedValue } from "../state/storage";
import { DEFAULT_FONT_SIZE, MIN_FONT_SIZE, MAX_FONT_SIZE } from "../terminal/fontSize";
import type { App, CapturePort, AppSeam } from "../app/seam";

const schema = storageSchema("roundup:app-settings", v.object({
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
}));

type Preferences = v.InferOutput<typeof schema>;

const [revision, changed] = createSignal(0);

const storage = () => storedValue("roundup:app-settings", schema, () => changed(value => value + 1));

/** One app-wide record; each untrusted field defaults independently. A revision notifies all open Project tabs. */
export const appSettings = (): Preferences => {
  revision();

  return storage().read() ?? v.parse(schema, {});
};

/** A failed durable write changes nothing; the settings view shows the returned cause. */
let saving: Promise<unknown> = Promise.resolve();

export const saveAppSettings = (patch: Partial<Preferences>, capture?: CapturePort): Promise<string | null> => {
  const captured = structuredClone(patch);

  const pending = saving.then(async () => {
    const before = appSettings();
    const replacement = captured.quickAdd !== undefined && captured.quickAdd !== before.quickAdd;

    try {
      if (replacement && capture) await capture.configure(captured.quickAdd!);
      const failure = await storage().write({ ...before, ...captured });

      if (failure && replacement && capture) await capture.configure(before.quickAdd);

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

    if (method === "agent.resume" || method === "workstream.clear") {
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

/** Keep native preference delivery outside Agent state; unavailable delivery restores the Token fallback. */
export const applySystemAccent = (app: Pick<App, "onSystemAccent">) => {
  const root = document.documentElement;
  let active = true;
  let release: (() => void) | undefined;

  const clear = () => {
    delete root.dataset.systemAccent;
    root.style.removeProperty("--system-accent-channels");
  };

  void app.onSystemAccent(accent => {
    if (!active) return;

    if (accent === null) {
      clear();

      return;
    }

    root.style.setProperty("--system-accent-channels", accent.map(channel => channel * 255).join(" "));
    root.dataset.systemAccent = "true";
  }).then(stop => { if (active) release = stop; else stop(); }, () => { if (active) clear(); });
  onCleanup(() => { active = false; release?.(); clear(); });
};
