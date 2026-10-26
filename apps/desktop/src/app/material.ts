import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import * as v from "valibot";

/** Reveal material only after the native window confirms it; a missing capability stays opaque. */
export const followMaterial = async (root: HTMLElement): Promise<() => void> => {
  const apply = (enabled: boolean) => root.toggleAttribute("data-native-material", enabled);
  let changed = false;

  const release = await listen("native-material", event => {
    changed = true;
    apply(v.parse(v.boolean(), event.payload));
  });

  try {
    const initial = v.parse(v.boolean(), await invoke("plugin:window-bar|native_material"));

    if (!changed) apply(initial);
  } catch (error) {
    release();
    root.removeAttribute("data-native-material");
    throw error;
  }

  return () => { release(); root.removeAttribute("data-native-material"); };
};
