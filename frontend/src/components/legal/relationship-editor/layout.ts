import Dagre from "@dagrejs/dagre";
import type { RFNode, RFEdge } from "./types";

const NODE_WIDTH = 160;
const NODE_HEIGHT = 120;

export function getLayoutedElements(
  nodes: RFNode[],
  edges: RFEdge[],
  direction: "TB" | "LR" = "TB",
): { nodes: RFNode[]; edges: RFEdge[] } {
  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));

  g.setGraph({
    rankdir: direction,
    nodesep: 80,
    ranksep: 100,
    marginx: 40,
    marginy: 40,
  });

  nodes.forEach((node) => {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  Dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}
