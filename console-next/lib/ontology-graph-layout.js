export function ontologyLaneKey(type) {
  const lane = {
    route: "01-route",
    "ui-action": "02-ui-action",
    api: "03-api",
    "gateway-handler": "04-gateway",
    controller: "05-controller",
    service: "06-service",
    "data-contract": "07-contract",
    "control-guard": "08-guard",
    "decision-path": "09-decision",
    "data-query": "10-query",
    "data-table": "11-table",
    "data-store": "12-store",
    "cache-key": "13-cache",
    "async-channel": "14-async",
    "eai-interface": "15-eai",
    "knowledge-cluster": "16-cluster",
    "retrieval-unit": "17-unit",
    path: "18-path"
  };
  return lane[type] || `99-${type}`;
}

export function ontologyLaneLabel(lane) {
  return String(lane || "").replace(/^\d+-/, "");
}

function compareNodePriority(a, b) {
  const aScore = Number(a?.isHighlighted ? 100 : 0) + Number(a?.confidence || 0) * 10;
  const bScore = Number(b?.isHighlighted ? 100 : 0) + Number(b?.confidence || 0) * 10;
  if (bScore !== aScore) return bScore - aScore;
  return String(a?.label || "").localeCompare(String(b?.label || ""));
}

function buildProjectionLayout(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return { width: 1280, height: 720, positions: {}, lanes: [], mode: "projection", spineNodeIds: [], pathNodeIds: new Set() };
  }
  const lanes = new Map();
  for (const node of nodes) {
    const lane = ontologyLaneKey(node.type);
    if (!lanes.has(lane)) lanes.set(lane, []);
    lanes.get(lane).push(node);
  }
  const laneEntries = Array.from(lanes.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const laneCount = laneEntries.length;
  const maxLaneSize = Math.max(...laneEntries.map(([, items]) => items.length), 1);
  const width = Math.max(1400, 220 + laneCount * 190);
  const height = Math.max(820, 160 + maxLaneSize * 96);
  const laneGap = laneCount <= 1 ? 0 : (width - 220) / (laneCount - 1);
  const positions = {};
  const layoutLanes = [];
  laneEntries.forEach(([lane, laneNodes], laneIndex) => {
    const x = 110 + laneIndex * laneGap;
    layoutLanes.push({ key: lane, label: ontologyLaneLabel(lane), x });
    const usableHeight = height - 140;
    const step = Math.max(84, Math.floor(usableHeight / Math.max(1, laneNodes.length)));
    const contentHeight = step * Math.max(0, laneNodes.length - 1);
    const startY = 70 + Math.max(0, Math.floor((usableHeight - contentHeight) / 2));
    laneNodes.forEach((node, nodeIndex) => {
      positions[node.id] = { x, y: startY + nodeIndex * step, lane };
    });
  });
  return { width, height, positions, lanes: layoutLanes, mode: "projection", spineNodeIds: [], pathNodeIds: new Set() };
}

function pickSelectedPath(representativePaths, selectedPathId) {
  const paths = Array.isArray(representativePaths) ? representativePaths : [];
  if (selectedPathId) {
    const matched = paths.find((path) => path.id === selectedPathId);
    if (matched) return matched;
  }
  return paths[0] || null;
}

function buildPathLayout(nodes, edges, representativePaths, selectedPathId) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edgeList = Array.isArray(edges) ? edges : [];
  const selectedPath = pickSelectedPath(representativePaths, selectedPathId);
  if (!selectedPath || !Array.isArray(selectedPath.nodeIds) || selectedPath.nodeIds.length < 2) {
    return buildProjectionLayout(nodes);
  }

  const rawSpine = selectedPath.nodeIds.filter((nodeId) => nodeById.has(nodeId));
  const spineNodeIds = Array.from(new Set(rawSpine));
  if (spineNodeIds.length < 2) {
    return buildProjectionLayout(nodes);
  }

  const pathNodeIds = new Set(spineNodeIds);
  const neighbors = new Map();
  for (const edge of edgeList) {
    if (!nodeById.has(edge.fromId) || !nodeById.has(edge.toId)) continue;
    if (!neighbors.has(edge.fromId)) neighbors.set(edge.fromId, []);
    if (!neighbors.has(edge.toId)) neighbors.set(edge.toId, []);
    neighbors.get(edge.fromId).push(edge.toId);
    neighbors.get(edge.toId).push(edge.fromId);
  }

  const renderableNodeIds = new Set(spineNodeIds);
  for (const edge of edgeList) {
    if (pathNodeIds.has(edge.fromId) || pathNodeIds.has(edge.toId)) {
      renderableNodeIds.add(edge.fromId);
      renderableNodeIds.add(edge.toId);
    }
  }

  // Keep 2-hop nodes only when they connect back into the selected path neighborhood.
  for (const nodeId of Array.from(renderableNodeIds)) {
    for (const neighborId of neighbors.get(nodeId) || []) {
      if (renderableNodeIds.size >= 48) break;
      renderableNodeIds.add(neighborId);
    }
  }

  const renderableNodes = Array.from(renderableNodeIds)
    .map((nodeId) => nodeById.get(nodeId))
    .filter(Boolean)
    .sort(compareNodePriority);

  const anchorIndexByNode = new Map();
  spineNodeIds.forEach((nodeId, index) => {
    anchorIndexByNode.set(nodeId, index);
  });

  let changed = true;
  while (changed) {
    changed = false;
    for (const node of renderableNodes) {
      if (anchorIndexByNode.has(node.id)) continue;
      const neighborAnchors = (neighbors.get(node.id) || [])
        .map((neighborId) => anchorIndexByNode.get(neighborId))
        .filter((value) => Number.isInteger(value));
      if (neighborAnchors.length > 0) {
        const average = Math.round(neighborAnchors.reduce((sum, value) => sum + value, 0) / neighborAnchors.length);
        anchorIndexByNode.set(node.id, Math.max(0, Math.min(spineNodeIds.length - 1, average)));
        changed = true;
      }
    }
  }

  const supportGroups = new Map();
  for (const node of renderableNodes) {
    if (pathNodeIds.has(node.id)) continue;
    const anchorIndex = anchorIndexByNode.get(node.id);
    if (!Number.isInteger(anchorIndex)) continue;
    if (!supportGroups.has(anchorIndex)) supportGroups.set(anchorIndex, []);
    supportGroups.get(anchorIndex).push(node);
  }
  for (const group of supportGroups.values()) {
    group.sort(compareNodePriority);
  }

  const horizontalGap = 220;
  const centerY = 430;
  const startX = 180;
  const positions = {};

  spineNodeIds.forEach((nodeId, index) => {
    positions[nodeId] = { x: startX + index * horizontalGap, y: centerY, lane: "path-spine" };
  });

  let maxBranchDepth = 0;
  for (const [anchorIndex, group] of supportGroups.entries()) {
    group.forEach((node, index) => {
      const side = index % 2 === 0 ? -1 : 1;
      const depth = Math.floor(index / 2) + 1;
      maxBranchDepth = Math.max(maxBranchDepth, depth);
      const lateralOffset = 34 * (depth - 1);
      positions[node.id] = {
        x: positions[spineNodeIds[anchorIndex]].x + lateralOffset,
        y: centerY + side * (90 + (depth - 1) * 92),
        lane: side < 0 ? "support-top" : "support-bottom"
      };
    });
  }

  const width = Math.max(1500, startX * 2 + Math.max(1, spineNodeIds.length - 1) * horizontalGap + 220);
  const height = Math.max(920, centerY + maxBranchDepth * 120 + 180);

  return {
    width,
    height,
    positions,
    lanes: [],
    mode: "path",
    spineNodeIds,
    pathNodeIds,
    selectedPath
  };
}

function buildComponentLayout(nodes, edges) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return { width: 1280, height: 720, positions: {}, lanes: [], mode: "component", spineNodeIds: [], pathNodeIds: new Set() };
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const adjacency = new Map();
  const degree = new Map();
  for (const node of nodes) {
    adjacency.set(node.id, []);
    degree.set(node.id, 0);
  }
  for (const edge of edges || []) {
    if (!nodeById.has(edge.fromId) || !nodeById.has(edge.toId)) continue;
    adjacency.get(edge.fromId).push(edge.toId);
    adjacency.get(edge.toId).push(edge.fromId);
    degree.set(edge.fromId, (degree.get(edge.fromId) || 0) + 1);
    degree.set(edge.toId, (degree.get(edge.toId) || 0) + 1);
  }

  const root = [...nodes].sort((a, b) => {
    const aScore = Number(a?.isHighlighted ? 100 : 0) + (degree.get(a.id) || 0) * 4 + Number(a?.confidence || 0) * 10;
    const bScore = Number(b?.isHighlighted ? 100 : 0) + (degree.get(b.id) || 0) * 4 + Number(b?.confidence || 0) * 10;
    if (bScore !== aScore) return bScore - aScore;
    return String(a?.label || "").localeCompare(String(b?.label || ""));
  })[0];

  const levels = new Map();
  const queue = root ? [root.id] : [];
  if (root) levels.set(root.id, 0);
  while (queue.length > 0) {
    const currentId = queue.shift();
    const currentLevel = levels.get(currentId) || 0;
    for (const nextId of adjacency.get(currentId) || []) {
      if (levels.has(nextId)) continue;
      levels.set(nextId, currentLevel + 1);
      queue.push(nextId);
    }
  }
  for (const node of nodes) {
    if (!levels.has(node.id)) {
      levels.set(node.id, Math.max(...Array.from(levels.values()), 0) + 1);
    }
  }

  const levelBuckets = new Map();
  for (const node of nodes) {
    const level = levels.get(node.id) || 0;
    if (!levelBuckets.has(level)) levelBuckets.set(level, []);
    levelBuckets.get(level).push(node);
  }
  for (const bucket of levelBuckets.values()) {
    bucket.sort((a, b) => {
      const laneDiff = ontologyLaneKey(a.type).localeCompare(ontologyLaneKey(b.type));
      if (laneDiff !== 0) return laneDiff;
      const degreeDiff = (degree.get(b.id) || 0) - (degree.get(a.id) || 0);
      if (degreeDiff !== 0) return degreeDiff;
      return compareNodePriority(a, b);
    });
  }

  const orderedLevels = Array.from(levelBuckets.keys()).sort((a, b) => a - b);
  const maxLevelSize = Math.max(...orderedLevels.map((level) => (levelBuckets.get(level) || []).length), 1);
  const horizontalGap = 260;
  const verticalGap = 104;
  const width = Math.max(1440, 240 + orderedLevels.length * horizontalGap);
  const height = Math.max(920, 200 + maxLevelSize * verticalGap);
  const positions = {};
  orderedLevels.forEach((level) => {
    const bucket = levelBuckets.get(level) || [];
    const x = 140 + level * horizontalGap;
    const contentHeight = Math.max(0, (bucket.length - 1) * verticalGap);
    const startY = 120 + Math.max(0, Math.floor((height - 240 - contentHeight) / 2));
    bucket.forEach((node, index) => {
      positions[node.id] = { x, y: startY + index * verticalGap, lane: ontologyLaneKey(node.type) };
    });
  });

  return {
    width,
    height,
    positions,
    lanes: [],
    mode: "component",
    spineNodeIds: root ? [root.id] : [],
    pathNodeIds: new Set(root ? [root.id] : [])
  };
}

export function buildOntologySvgLayout({ nodes, edges, representativePaths, selectedPathId, focusMode }) {
  if (focusMode === "path") {
    return buildPathLayout(nodes || [], edges || [], representativePaths || [], selectedPathId || "");
  }
  if (focusMode === "component") {
    return buildComponentLayout(nodes || [], edges || []);
  }
  return buildProjectionLayout(nodes || []);
}

export function buildOntologyEdgePath(edge, layout) {
  const from = layout?.positions?.[edge?.fromId];
  const to = layout?.positions?.[edge?.toId];
  if (!from || !to) return "";

  if (layout?.mode === "component") {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const midX = from.x + dx / 2;
    const ctrlY = from.y + dy / 2 + (dy >= 0 ? -32 : 32);
    return `M ${from.x} ${from.y} Q ${midX} ${ctrlY} ${to.x} ${to.y}`;
  }

  if (layout?.mode !== "path") {
    return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  }

  const pathNodeIds = layout.pathNodeIds || new Set();
  const fromIsPath = pathNodeIds.has(edge.fromId);
  const toIsPath = pathNodeIds.has(edge.toId);
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (fromIsPath && toIsPath) {
    return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  }

  const midX = from.x + dx / 2;
  const arc = Math.max(42, Math.min(140, Math.abs(dx) * 0.16 + Math.abs(dy) * 0.3));
  const ctrlY = from.y + dy / 2 + (dy >= 0 ? -arc : arc);
  return `M ${from.x} ${from.y} Q ${midX} ${ctrlY} ${to.x} ${to.y}`;
}

export function buildOntologyRenderableGraph({ nodes, edges, representativePaths, selectedPathId, focusMode }) {
  const layout = buildOntologySvgLayout({ nodes, edges, representativePaths, selectedPathId, focusMode });
  const pathNodeIds = layout.pathNodeIds || new Set();
  const renderableEdges = (edges || []).filter((edge) => layout.positions[edge.fromId] && layout.positions[edge.toId]);
  const connectedNodeIds = new Set();
  for (const edge of renderableEdges) {
    connectedNodeIds.add(edge.fromId);
    connectedNodeIds.add(edge.toId);
  }
  const renderableNodes = (nodes || []).filter((node) => {
    if (!layout.positions[node.id]) return false;
    if (focusMode !== "path") return true;
    return connectedNodeIds.has(node.id) || pathNodeIds.has(node.id);
  });
  return { layout, nodes: renderableNodes, edges: renderableEdges };
}
