import { createContext, type Component } from "solid-js";

/** U7709: how the Changes view draws a statechart block, given by the App so `changes` imports nothing from `pads`. */
export type ChartView = Component<{ text: string }>;

export const noChart: ChartView = () => null;

export const ChartContext = createContext<ChartView>(noChart);
