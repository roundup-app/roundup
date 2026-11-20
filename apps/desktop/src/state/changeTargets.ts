import { createSignal } from "solid-js";

/** U7672d: what the Changes view lists for an Agent: its own files (`changes`), its whole folder (`tree`) or its commits (`branch`). */
export type ChangeTarget = "changes" | "tree" | "branch";

/** U7672d: each Agent's choice, kept for the session; an Agent never chosen for lists `changes`. */
export const createChangeTargets = () => {
  const [chosen, setChosen] = createSignal<ReadonlyMap<string, ChangeTarget>>(new Map());

  return {
    read: (id: string): ChangeTarget => chosen().get(id) ?? "changes",
    choose: (id: string, target: ChangeTarget) => setChosen(previous => new Map(previous).set(id, target)),
  };
};
