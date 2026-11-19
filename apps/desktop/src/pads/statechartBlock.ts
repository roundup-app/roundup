import * as v from "valibot";
import { copy } from "./copy";
import type { VisualMount } from "./visualBlocks";

const Block = v.object({
  summary: v.string(),
  writtenBy: v.string(),
  rules: v.array(v.object({ id: v.string(), name: v.string(), verdict: v.picklist(["holds", "broken"]) })),
  states: v.array(v.object({ id: v.string(), label: v.string(), values: v.record(v.string(), v.string()), breaks: v.array(v.string()) })),
  start: v.string(),
  steps: v.array(v.object({ from: v.string(), to: v.string(), label: v.string() })),
  stopped: v.string(),
});

export type Statechart = v.InferOutput<typeof Block>;

/** One distinct step: the first of the steps that share a `from`, `to` and `label`. */
type Move = { key: string; from: string; to: string; label: string };

type Point = { x: number; y: number };

export type Layout = { width: number; height: number; boxes: Record<string, Point>; routes: Record<string, Point[]> };

export type MachineConfig = { id: string; initial: string; states: Record<string, { on: Record<string, string> }> };

export type StepActor = { start(): void; send(event: { type: string }): void; stop(): void; getSnapshot(): { value: unknown } };

/** The calls the Pad makes of XState and of the layout library (elkjs). */
export type StatechartApi = {
  /** A machine whose states each list the events they take and the state each leads to; the call returns what makes a running actor of it. */
  createMachine(config: MachineConfig): () => StepActor;
  /** Places each box and routes each move; `moves` are `[key, from, to]`. */
  layout(ids: string[], moves: [string, string, string][], box: { width: number; height: number }): Promise<Layout>;
};

const BOX = { width: 132, height: 44 };

/** The block's object, or the first failure in words. */
export const readStatechart = (text: string): { chart: Statechart } | { cause: string } => {
  let json: unknown;

  try {
    json = JSON.parse(text);
  } catch {
    return { cause: copy.statechartNotJson };
  }

  const parsed = v.safeParse(Block, json);

  if (!parsed.success) return { cause: copy.statechartField(v.getDotPath(parsed.issues[0]) ?? "block") };
  const chart = parsed.output;
  const states = new Set(chart.states.map((state) => state.id));
  const rules = new Set(chart.rules.map((rule) => rule.id));

  if (!states.has(chart.start)) return { cause: copy.statechartNoState("start", chart.start) };

  for (const step of chart.steps)
    for (const end of [step.from, step.to]) if (!states.has(end)) return { cause: copy.statechartNoState("steps", end) };

  for (const state of chart.states)
    for (const rule of state.breaks) if (!rules.has(rule)) return { cause: copy.statechartNoRule(state.id, rule) };

  return { chart };
};

const movesOf = (chart: Statechart) => {
  const moves: Move[] = [];

  for (const step of chart.steps)
    if (!moves.some((move) => move.from === step.from && move.to === step.to && move.label === step.label)) moves.push({ ...step, key: `m${moves.length}` });

  return moves;
};

/** The moves of the shortest way from `from` to a breaking state; the first in the block's order among equals. Empty when there is none. */
const wayToBreak = (chart: Statechart, moves: Move[], from: string) => {
  const breaking = new Set(chart.states.filter((state) => state.breaks.length > 0).map((state) => state.id));
  const reached = new Map<string, Move[]>([[from, []]]);
  const queue = [from];

  for (const at of queue) {
    const way = reached.get(at) ?? [];

    if (breaking.has(at)) return way;

    for (const move of moves.filter((candidate) => candidate.from === at))
      if (!reached.has(move.to)) {
        reached.set(move.to, [...way, move]);
        queue.push(move.to);
      }
  }

  return [];
};

const element = <Tag extends keyof HTMLElementTagNameMap>(tag: Tag, className?: string, text?: string) => {
  const node = document.createElement(tag);

  if (className) node.className = className;

  if (text !== undefined) node.textContent = text;

  return node;
};

const button = (label: string, onClick: () => void) => {
  const node = element("button", undefined, label);

  node.type = "button";
  node.dataset.button = "quiet";
  // listener-owner: the button belongs to a block's host, which the Pad drops with it.
  node.addEventListener("click", onClick);

  return node;
};

const svgNS = "http://www.w3.org/2000/svg";

/** The edges as an SVG whose role keeps the editor's 16 px icon rule off it; each polyline ends in an arrowhead. */
const edgesSvg = (layout: Layout, moves: Move[]) => {
  const svg = document.createElementNS(svgNS, "svg");

  svg.setAttribute("width", String(layout.width));
  svg.setAttribute("height", String(layout.height));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("role", "graphics-document");

  const defs = document.createElementNS(svgNS, "defs");
  const marker = document.createElementNS(svgNS, "marker");
  const head = document.createElementNS(svgNS, "path");

  for (const [name, value] of Object.entries({ id: "statechart-head", viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "8", markerHeight: "8", orient: "auto-start-reverse" })) marker.setAttribute(name, value);
  head.setAttribute("d", "M0 0L10 5L0 10z");
  head.setAttribute("class", "statechart-head");
  marker.append(head);
  defs.append(marker);
  svg.append(defs);

  for (const move of moves) {
    const route = layout.routes[move.key] ?? [];
    const line = document.createElementNS(svgNS, "polyline");

    line.setAttribute("points", route.map((point) => `${point.x},${point.y}`).join(" "));
    line.setAttribute("class", "statechart-line");
    line.setAttribute("marker-end", "url(#statechart-head)");
    svg.append(line);
  }

  return svg;
};

/** SC1 to SC5: the block as a chart the user steps, run by an XState machine. */
export const mountStatechart = (api: StatechartApi): VisualMount => (host, { text }) => {
  host.classList.add("visual-statechart");
  const read = readStatechart(text);

  if ("cause" in read) {
    const source = element("pre", undefined, text);
    const line = element("p", "visual-error", copy.statechart(read.cause));

    line.setAttribute("role", "alert");
    host.replaceChildren(source, line);

    return () => {};
  }

  const { chart } = read;

  const moves = movesOf(chart);
  const stateOf = new Map(chart.states.map((state) => [state.id, state]));
  const ruleName = new Map(chart.rules.map((rule) => [rule.id, rule.name]));

  const spawn = api.createMachine({
    id: "statechart",
    initial: chart.start,
    states: Object.fromEntries(chart.states.map((state) => [state.id, { on: Object.fromEntries(moves.filter((move) => move.from === state.id).map((move) => [move.key, move.to])) }])),
  });

  let actor = spawn();
  let taken: Move[] = [];
  let live = true;
  let opened = false;

  actor.start();
  const lit = () => String(actor.getSnapshot().value);
  const out = () => moves.filter((move) => move.from === lit());

  const play = (way: Move[]) => {
    for (const move of way) actor.send({ type: move.key });
    taken = [...taken, ...way];
    update();
  };

  const restart = (way: Move[]) => {
    actor.stop();
    actor = spawn();
    actor.start();
    taken = [];
    play(way);
  };

  const summary = element("p", "statechart-summary", chart.summary);
  const credit = element("p", "statechart-credit", copy.statechartCredit(chart.writtenBy));
  const rules = element("div", "statechart-rules");

  for (const rule of chart.rules) rules.append(element("p", `statechart-rule is-${rule.verdict}`, copy.statechartRule(rule.name, rule.verdict)));

  const frame = element("div", "statechart-chart");
  const boxes = new Map<string, HTMLElement>();
  const arrows = new Map<string, HTMLButtonElement>();
  const bar = element("p", "statechart-bar");
  const group = element("div", "statechart-moves");
  const heading = element("p", "statechart-moves-title", copy.statechartMoves);
  const list = element("div", "statechart-move-list");
  const back = button(copy.walkBack, () => restart(taken.slice(0, -1)));
  const startOver = button(copy.statechartStartOver, () => restart([]));
  const walk = button(copy.statechartWalk, () => play(wayToBreak(chart, moves, lit())));
  const reason = element("span", "statechart-reason");

  const toggle = button(copy.statechartDetails, () => {
    opened = !opened;
    update();
  });

  const details = element("div", "statechart-details");

  heading.tabIndex = -1;
  bar.setAttribute("role", "status");
  toggle.setAttribute("aria-expanded", "false");
  group.append(heading, list);
  const hasBreak = chart.states.some((state) => state.breaks.length > 0);
  const controls = element("div", "statechart-controls");

  controls.append(back, startOver);

  if (hasBreak) controls.append(walk, reason);

  const paintChart = (broken: string[] | undefined) => {
    for (const [id, box] of boxes) {
      box.classList.toggle("is-lit", id === lit());
      box.classList.toggle("is-red", broken !== undefined && id === lit());
      box.toggleAttribute("aria-current", id === lit());
    }

    const offered = new Set(out().map((move) => move.key));

    for (const [key, arrow] of arrows) arrow.disabled = !offered.has(key);
    bar.textContent = broken ? copy.statechartBreaks(broken.join(", ")) : "";
    list.replaceChildren(...out().map((move) => button(move.label, () => play([move]))));
    list.hidden = list.childElementCount === 0;
  };

  const paintControls = (onBreak: boolean) => {
    back.disabled = taken.length === 0;
    walk.disabled = onBreak || wayToBreak(chart, moves, lit()).length === 0;
    reason.textContent = onBreak ? copy.statechartAlreadyBroken : walk.disabled ? copy.statechartNoBreakReachable : "";
  };

  const paintDetails = (at: Statechart["states"][number] | undefined) => {
    toggle.setAttribute("aria-expanded", String(opened));

    if (!opened) return details.replaceChildren();
    const values = element("dl", "statechart-values");

    for (const [name, value] of Object.entries(at?.values ?? {})) values.append(element("dt", undefined, name), element("dd", undefined, value));
    details.replaceChildren(element("p", "statechart-state", at?.label ?? ""), values, element("p", "statechart-stopped", chart.stopped));
  };

  const update = () => {
    const focusInside = host.contains(document.activeElement);
    const at = stateOf.get(lit());
    const broken = (at?.breaks ?? []).map((id) => ruleName.get(id) ?? id);

    paintChart(broken.length > 0 ? broken : undefined);
    paintControls(broken.length > 0);
    paintDetails(at);
    // The button the user pressed may be gone or disabled; focus goes where the next Tab reaches the moves.
    const now = document.activeElement;

    if (focusInside && !(now instanceof HTMLButtonElement && host.contains(now) && !now.disabled)) heading.focus();
  };

  host.replaceChildren(summary, credit, rules, frame, bar, controls, group, toggle, details);
  update();

  void api
    .layout(chart.states.map((state) => state.id), moves.map((move) => [move.key, move.from, move.to]), BOX)
    .then((layout) => {
      if (!live) return;
      const svg = edgesSvg(layout, moves);

      const canvas = element("div", "statechart-canvas");

      canvas.style.width = `${layout.width}px`;
      canvas.style.height = `${layout.height}px`;
      canvas.append(svg);

      for (const state of chart.states) {
        const at = layout.boxes[state.id] ?? { x: 0, y: 0 };
        const box = element("div", "statechart-box", state.label);

        box.dataset.state = state.id;

        box.style.cssText = `left:${at.x}px;top:${at.y}px;width:${BOX.width}px;height:${BOX.height}px`;
        boxes.set(state.id, box);
        canvas.append(box);
      }

      for (const move of moves) {
        const route = layout.routes[move.key] ?? [];
        const mid = route[Math.floor(route.length / 2)] ?? { x: 0, y: 0 };
        const arrow = button(move.label, () => play([move]));

        arrow.className = "statechart-arrow";
        arrow.setAttribute("aria-label", move.label);
        arrow.style.cssText = `left:${mid.x}px;top:${mid.y}px`;
        arrows.set(move.key, arrow);
        canvas.append(arrow);
      }

      frame.replaceChildren(canvas);
      update();
    });

  return () => {
    live = false;
    actor.stop();
  };
};
