import { copy } from "./copy";
import type { ExitState } from "../state/rail";

/** How an exited node reads on screen: its code, a signal, or nothing known because the node has no Terminal. */
export const exitText = (exit: ExitState): string => {
  switch (exit.kind) {
    case "code":
      return copy.exitedCode(exit.code);
    case "signal":
      return copy.exitedBySignal;
    case "unknown":
      return copy.exited;
  }
};
