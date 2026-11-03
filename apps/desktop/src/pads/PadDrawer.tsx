import { lazy } from "solid-js";

// The Pad's source, draft recovery and editor mount only when a Pad is opened.
export const PadDrawer = lazy(() => import("./PadContent").then(module => ({ default: module.PadDrawer })));

export const PadHost = lazy(() => import("./PadContent").then(module => ({ default: module.PadHost })));
