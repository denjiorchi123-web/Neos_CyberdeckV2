/**
 * Dijkstra shortest-path routing for mesh nodes.
 * Returns next-hop routes from localNodeId to every reachable node.
 */
function buildGraph(nodes, localNodeId) {
  const graph = new Map();
  const ids = nodes.map((n) => n.id);

  for (const id of ids) {
    graph.set(id, []);
  }

  if (!graph.has(localNodeId)) {
    graph.set(localNodeId, []);
  }

  for (const node of nodes) {
    if (node.id === localNodeId) continue;
    if (Number(node.is_online) === 1 || node.is_online === true) {
      graph.get(localNodeId).push({ to: node.id, weight: 1 });
      graph.get(node.id).push({ to: localNodeId, weight: 1 });
    }
  }

  return graph;
}

function dijkstra(graph, source) {
  const dist = new Map();
  const prev = new Map();
  const visited = new Set();

  for (const node of graph.keys()) {
    dist.set(node, Infinity);
    prev.set(node, null);
  }
  dist.set(source, 0);

  while (visited.size < graph.size) {
    let current = null;
    let best = Infinity;
    for (const [node, d] of dist.entries()) {
      if (!visited.has(node) && d < best) {
        best = d;
        current = node;
      }
    }
    if (current === null || best === Infinity) break;
    visited.add(current);

    const edges = graph.get(current) || [];
    for (const edge of edges) {
      const alt = dist.get(current) + edge.weight;
      if (alt < dist.get(edge.to)) {
        dist.set(edge.to, alt);
        prev.set(edge.to, current);
      }
    }
  }

  return { dist, prev };
}

function nextHop(source, target, prev) {
  if (source === target) return source;
  let step = target;
  let previous = prev.get(step);
  while (previous && previous !== source) {
    step = previous;
    previous = prev.get(step);
  }
  if (previous === source) return step;
  return null;
}

function buildRoutingTable(nodes, localNodeId) {
  const graph = buildGraph(nodes, localNodeId);
  const { dist, prev } = dijkstra(graph, localNodeId);
  const routes = [];

  for (const node of nodes) {
    if (node.id === localNodeId) continue;
    const hopCount = dist.get(node.id);
    if (!Number.isFinite(hopCount) || hopCount === Infinity) continue;
    const viaNode = nextHop(localNodeId, node.id, prev);
    if (!viaNode) continue;
    routes.push({
      destination: node.id,
      viaNode,
      hopCount,
    });
  }

  return routes;
}

module.exports = {
  buildGraph,
  dijkstra,
  nextHop,
  buildRoutingTable,
};
