import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import * as v from "valibot";

/** Reveal material only after the native window confirms it; a missing capability stays opaque. */
export const followMaterial = async (root: HTMLElement): Promise<() => void> => {
  const apply = (enabled: unknown) => root.toggleAttribute("data-native-material", v.parse(v.boolean(), enabled));
  let changed = false;
  const release = await listen("native-material", event => {
    changed = true;
    apply(event.payload);
  });

  try {
    const initial = await invoke<boolean>("plugin:window-bar|native_material");

    if (!changed) apply(initial);
  } catch (error) {
    release();
    root.removeAttribute("data-native-material");
    throw error;
  }

  return () => { release(); root.removeAttribute("data-native-material"); };
};
