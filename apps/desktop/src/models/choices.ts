import { createSignal } from "solid-js";
import type { ModelList } from "@contracts/project/ModelList";
import type { AppSeam } from "../app/seam";

/** `default` is the first option of every select (U377): the value `null`, nothing passed, the user's own Claude Code default. */
export const DEFAULT_LABEL = "default";

/** The Adapter's lists (`models.list`), asked once on first use: a surface that never opens a select never asks. */
export const createChoices = (app: AppSeam) => {
  const [list, setList] = createSignal<ModelList | null>(null);
  const [failure, setFailure] = createSignal<string | null>(null);
  let asked = false;

  const load = async () => {
    if (asked) return;

    asked = true;

    try {
      setList(await app.rpc("models.list", null));
    } catch (error) {
      asked = false;

      if (!(error instanceof Error)) throw error;

      setFailure(error.message);
    }
  };

  /** The label of a Model id, else the id itself: an id the list no longer offers still reads. */
  const labelOf = (id: string | null): string => (id === null ? DEFAULT_LABEL : (list()?.models.find((each) => each.id === id)?.label ?? id));

  return { list, failure, load, labelOf };
};

