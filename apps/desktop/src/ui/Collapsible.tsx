import "./Collapsible.css";
import { Collapsible as Root, CollapsiblePanel, CollapsibleTrigger } from "@ui-sdk/solid/collapsible";

/** Token-styled callers share ui-sdk's disclosure semantics and keyboard behavior; the body is not rendered while closed. */
export const Collapsible = { Root, Trigger: CollapsibleTrigger, Content: CollapsiblePanel };
