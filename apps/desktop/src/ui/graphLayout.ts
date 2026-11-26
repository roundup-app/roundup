export type Point = { x: number; y: number };

export type Size = { width: number; height: number };

export type Layout = {
  width: number;
  height: number;
  boxes: Record<string, Point>;
  routes: Record<string, Point[]>;
  labels: Record<string, Point>;
};

/** Places each box (`[id, size]`), routes each move and centres its label where it is clear of boxes and other lines; `moves` are `[key, from, to, label size]`. */
export type LayoutGraph = (
  boxes: [string, Size][],
  moves: [string, string, string, Size][],
) => Promise<Layout>;

/** The one layered layout the App draws graphs with (a Pad's statechart, the Changes readback's diagram): `elkjs`, requested when the first graph draws and never before. */
export const loadLayout = async (): Promise<LayoutGraph> => {
  const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
  const elk = new ELK();

  return async (boxes, moves) => {
    const graph = await elk.layout({
      id: "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "DOWN",
        "elk.edgeRouting": "POLYLINE",
        "elk.edgeLabels.inline": "true",
      },
      children: boxes.map(([id, size]) => ({ id, ...size })),
      edges: moves.map(([id, from, to, label]) => ({
        id,
        sources: [from],
        targets: [to],
        labels: [{ text: id, ...label }],
      })),
    });

    const point = (at: { x: number; y: number }) => ({ x: at.x, y: at.y });

    const labelAt = (edge: {
      labels?: { x?: number; y?: number; width?: number; height?: number }[];
    }) => {
      const label = edge.labels?.[0];

      return {
        x: (label?.x ?? 0) + (label?.width ?? 0) / 2,
        y: (label?.y ?? 0) + (label?.height ?? 0) / 2,
      };
    };

    return {
      width: (graph.width ?? 0) + 1,
      height: (graph.height ?? 0) + 1,
      boxes: Object.fromEntries(
        (graph.children ?? []).map((child) => [
          child.id,
          { x: child.x ?? 0, y: child.y ?? 0 },
        ]),
      ),
      labels: Object.fromEntries(
        (graph.edges ?? []).map((edge) => [edge.id, labelAt(edge)]),
      ),
      routes: Object.fromEntries(
        (graph.edges ?? []).map((edge) => {
          const section = edge.sections?.[0];

          return [
            edge.id,
            section
              ? [
                  point(section.startPoint),
                  ...(section.bendPoints ?? []).map(point),
                  point(section.endPoint),
                ]
              : [],
          ];
        }),
      ),
    };
  };
};
