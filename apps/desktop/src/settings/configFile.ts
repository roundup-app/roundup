import { createSignal } from "solid-js";
import * as v from "valibot";

/** MC40, MC41: the last good `look.json` and `keys.json` the Daemon read; empty means no file. */
const [look, setLook] = createSignal<Readonly<Record<string, string>>>({});

const [keys, setKeys] = createSignal<Readonly<Record<string, string>>>({});

export const fileKeys = keys;

export const setFileLook = setLook;

export const setFileKeys = setKeys;

export type LookSettings = Partial<{ mode: "dark" | "light" | "system"; interfaceScale: "small" | "default" | "large"; fontFamily: string; fontSize: number }>;

const modes = v.picklist(["dark", "light", "system"]);

const scales = v.picklist(["small", "default", "large"]);

/** The App settings a `look.json` names, as the settings record holds them; the Daemon already refused any other value. */
export const lookSettings = (): LookSettings => {
  const { mode, interfaceScale, fontFamily, fontSize } = look();
  const named: LookSettings = {};
  const chosenMode = v.safeParse(modes, mode);
  const chosenScale = v.safeParse(scales, interfaceScale);

  if (chosenMode.success) named.mode = chosenMode.output;

  if (chosenScale.success) named.interfaceScale = chosenScale.output;

  if (fontFamily) named.fontFamily = fontFamily;

  if (fontSize) named.fontSize = Number(fontSize);

  return named;
};

/** The colour Tokens `look.json` sets, as `{ "--accent": "#fff" }`. */
export const lookColours = (): Record<string, string> =>
  Object.fromEntries(Object.entries(look()).filter(([key]) => key.startsWith("color.")).map(([key, value]) => [`--${key.slice(6)}`, value]));

/** MC40: a setting the file names shows as set by the file, read-only. */
export const setByFile = (name: string): boolean => name in look() && ["mode", "interfaceScale", "fontFamily", "fontSize"].includes(name);
