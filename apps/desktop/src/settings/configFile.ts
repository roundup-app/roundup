import { createSignal } from "solid-js";

/** MC40, MC41: the last good `look.json` and `keys.json` the Daemon read; empty means no file. */
const [look, setLook] = createSignal<Readonly<Record<string, string>>>({});
const [keys, setKeys] = createSignal<Readonly<Record<string, string>>>({});

export const fileKeys = keys;

export const setFileLook = setLook;

export const setFileKeys = setKeys;

/** The App settings a `look.json` names, as the settings record holds them. */
export const lookSettings = () => {
  const { mode, interfaceScale, fontFamily, fontSize } = look();

  return {
    ...(mode ? { mode: mode as "dark" | "light" | "system" } : {}),
    ...(interfaceScale ? { interfaceScale: interfaceScale as "small" | "default" | "large" } : {}),
    ...(fontFamily ? { fontFamily } : {}),
    ...(fontSize ? { fontSize: Number(fontSize) } : {}),
  };
};

/** The colour Tokens `look.json` sets, as `{ "--accent": "#fff" }`. */
export const lookColours = (): Record<string, string> =>
  Object.fromEntries(Object.entries(look()).filter(([key]) => key.startsWith("color.")).map(([key, value]) => [`--${key.slice(6)}`, value]));

/** MC40: a setting the file names shows as set by the file, read-only. */
export const setByFile = (name: "mode" | "interfaceScale" | "fontFamily" | "fontSize"): boolean => name in look();
