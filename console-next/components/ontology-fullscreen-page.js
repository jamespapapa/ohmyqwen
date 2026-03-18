"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

async function getJson(url, init) {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers || {})
    }
  });

  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { error: text || "non-json response" };
  }

  if (!response.ok) {
    throw new Error(payload.error || `request failed (${response.status})`);
  }

  return payload;
}

function shortText(text, max = 150) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}...`;
}

function ontologyNodeTypeColor(type) {
  const colors = {
    route: "#2563eb",
    "ui-action": "#0f766e",
    api: "#0891b2",
    "gateway-handler": "#7c3aed",
    controller: "#4f46e5",
    service: "#9333ea",
    "data-contract": "#f59e0b",
    "data-query": "#ea580c",
    "data-table": "#b45309",
    "data-store": "#dc2626",
    "cache-key": "#be123c",
    "async-channel": "#db2777",
    "eai-interface": "#c026d3",
    "control-guard": "#65a30d",
    "decision-path": "#84cc16",
    "knowledge-cluster": "#475569",
    "retrieval-unit": "#334155",
    path: "#64748b"
  };
  return colors[type] || "#64748b";
}

function ontologyStatusColor(status) {
  if (status === "validated") return "#166534";
  if (status === "candidate") return "#b45309";
  if (status === "contested") return "#b91c1c";
  if (status === "deprecated") return "#6b7280";
  if (status === "stale") return "#92400e";
  return "#475569";
}

function ontologyLaneKey(type) {
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

function buildOntologySvgLayout(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return { width: 1280, height: 720, positions: {} };
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
  laneEntries.forEach(([lane, laneNodes], laneIndex) => {
    const x = 110 + laneIndex * laneGap;
    const usableHeight = height - 140;
    const step = Math.max(84, Math.floor(usableHeight / Math.max(1, laneNodes.length)));
    const contentHeight = step * Math.max(0, laneNodes.length - 1);
    const startY = 70 + Math.max(0, Math.floor((usableHeight - contentHeight) / 2));
    laneNodes.forEach((node, nodeIndex) => {
      positions[node.id] = { x, y: startY + nodeIndex * step, lane };
    });
  });
  return { width, height, positions };
}

function pickDefaultOntologyNodeId(ontology) {
  return (
    ontology?.selectedProjection?.highlightedNodeIds?.[0] ||
    ontology?.selectedProjection?.representativePaths?.[0]?.nodeIds?.[0] ||
    ontology?.selectedProjection?.nodes?.[0]?.id ||
    ""
  );
}

export default function OntologyFullscreenPage({ projectId }) {
  const [ontologyViewData, setOntologyViewData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [projectionId, setProjectionId] = useState("projection:front-back-flow");
  const [nodeTypeFilter, setNodeTypeFilter] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState("");

  async function loadOntologyView(options = {}) {
    if (!projectId) return;
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams();
      const nextProjectionId = options.projectionId ?? projectionId;
      const nextNodeType = options.nodeType ?? nodeTypeFilter;
      const nextSearch = options.search ?? appliedSearch;
      if (nextProjectionId) query.set("projectionId", nextProjectionId);
      if (nextNodeType && nextNodeType !== "all") query.set("nodeType", nextNodeType);
      if (nextSearch && String(nextSearch).trim()) query.set("search", String(nextSearch).trim());
      query.set("nodeLimit", String(options.nodeLimit ?? 180));
      query.set("edgeLimit", String(options.edgeLimit ?? 360));
      const response = await getJson(`/api/projects/${projectId}/ontology?${query.toString()}`);
      setOntologyViewData(response);
      setProjectionId(response?.ontology?.filters?.selectedProjectionId || nextProjectionId || "projection:front-back-flow");
      setSelectedNodeId((current) => {
        const nodes = response?.ontology?.selectedProjection?.nodes || [];
        if (current && nodes.some((node) => node.id === current)) return current;
        return pickDefaultOntologyNodeId(response?.ontology);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOntologyView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const ontology = ontologyViewData?.ontology || null;
  const projection = ontology?.selectedProjection || null;
  const selectedNode = useMemo(
    () => projection?.nodes?.find((node) => node.id === selectedNodeId) || projection?.nodes?.[0] || null,
    [projection, selectedNodeId]
  );
  const adjacentEdges = useMemo(() => {
    if (!projection || !selectedNode) return [];
    return (projection.edges || []).filter((edge) => edge.fromId === selectedNode.id || edge.toId === selectedNode.id);
  }, [projection, selectedNode]);
  const layout = useMemo(() => buildOntologySvgLayout(projection?.nodes || []), [projection?.nodes]);

  return (
    <main style={{ minHeight: "100vh", padding: 16, display: "grid", gap: 16 }}>
      <section className="hero" style={{ padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div>
            <h1 style={{ marginBottom: 6 }}>Ontology Graph Fullscreen</h1>
            <p style={{ maxWidth: 900 }}>
              projectId={projectId} · ontology는 analyze 시 메모리에서 생성되고, 현재는 filesystem artifact(JSON/MD)로 저장된다. DB backing은 아니다.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href="/" className="secondary" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none", padding: "11px 12px", borderRadius: 10 }}>
              메인으로
            </Link>
            <button type="button" className="secondary" onClick={() => void loadOntologyView()} disabled={loading} style={{ width: "auto" }}>
              {loading ? "불러오는 중" : "새로고침"}
            </button>
          </div>
        </div>
      </section>

      <section className="card" style={{ padding: 14 }}>
        <div className="toolbar" style={{ marginTop: 0, alignItems: "center" }}>
          <select
            value={projectionId}
            onChange={(e) => {
              const value = e.target.value;
              setProjectionId(value);
              setSelectedNodeId("");
              void loadOntologyView({ projectionId: value, nodeType: nodeTypeFilter, search: appliedSearch });
            }}
            disabled={loading}
            style={{ minWidth: 240, width: "auto" }}
          >
            {((ontology?.projections || []).length > 0 ? ontology.projections : [{ id: "projection:front-back-flow", title: "Front to Back Flow", type: "front-back-flow" }]).map((item) => (
              <option key={item.id} value={item.id}>{item.title} · {item.type}</option>
            ))}
          </select>
          <select
            value={nodeTypeFilter}
            onChange={(e) => {
              const value = e.target.value;
              setNodeTypeFilter(value);
              setSelectedNodeId("");
              void loadOntologyView({ projectionId, nodeType: value, search: appliedSearch });
            }}
            disabled={loading}
            style={{ minWidth: 180, width: "auto" }}
          >
            <option value="all">all node types</option>
            {(projection?.availableNodeTypes || []).map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="node/path/action 검색" style={{ flex: 1 }} />
          <button type="button" className="secondary" onClick={() => { setAppliedSearch(searchInput.trim()); setSelectedNodeId(""); void loadOntologyView({ projectionId, nodeType: nodeTypeFilter, search: searchInput.trim() }); }} disabled={loading} style={{ width: "auto" }}>
            적용
          </button>
          <button type="button" className="secondary" onClick={() => { setSearchInput(""); setAppliedSearch(""); setNodeTypeFilter("all"); setSelectedNodeId(""); void loadOntologyView({ projectionId, nodeType: "all", search: "" }); }} disabled={loading} style={{ width: "auto" }}>
            초기화
          </button>
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          nodes={ontology?.graph?.nodeCount ?? 0} · edges={ontology?.graph?.edgeCount ?? 0} · selectedProjection={projection?.id || "-"} · storage={ontology?.storage?.graphSnapshotPath || "-"}
        </div>
        {error ? <div className="error" style={{ marginTop: 8 }}>{error}</div> : null}
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 3fr) minmax(320px, 1.15fr)", gap: 16, alignItems: "start" }}>
        <div className="card" style={{ padding: 12, minHeight: "78vh" }}>
          <div className="label">Projection Graph</div>
          <div style={{ marginTop: 8, border: "1px solid #d7dde7", borderRadius: 12, overflow: "auto", background: "#f8fafc", maxHeight: "78vh" }}>
            <svg viewBox={`0 0 ${layout.width} ${layout.height}`} style={{ width: "100%", minHeight: "78vh", display: "block" }}>
              <rect x="0" y="0" width={layout.width} height={layout.height} fill="#f8fafc" />
              {(projection?.edges || []).map((edge) => {
                const from = layout.positions[edge.fromId];
                const to = layout.positions[edge.toId];
                if (!from || !to) return null;
                const selected = selectedNode && (edge.fromId === selectedNode.id || edge.toId === selectedNode.id);
                return (
                  <line
                    key={edge.id}
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke={selected ? "#0f172a" : edge.isHighlighted ? "#334155" : "#cbd5e1"}
                    strokeWidth={selected ? 2.5 : edge.isHighlighted ? 1.9 : 1.1}
                    opacity={selected ? 0.95 : edge.isHighlighted ? 0.75 : 0.5}
                  />
                );
              })}
              {(projection?.nodes || []).map((node) => {
                const position = layout.positions[node.id];
                if (!position) return null;
                const selected = selectedNode?.id === node.id;
                return (
                  <g key={node.id} transform={`translate(${position.x}, ${position.y})`} onClick={() => setSelectedNodeId(node.id)} style={{ cursor: "pointer" }}>
                    <circle r={selected ? 21 : 17} fill={ontologyNodeTypeColor(node.type)} opacity={node.isHighlighted ? 0.96 : 0.82} stroke={selected ? "#0f172a" : node.isHighlighted ? "#1e293b" : "#cbd5e1"} strokeWidth={selected ? 3 : 1.5} />
                    <text x="0" y={selected ? 40 : 35} textAnchor="middle" fontSize="12" fill="#0f172a">{shortText(node.label, 22)}</text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        <div style={{ display: "grid", gap: 16 }}>
          <div className="card">
            <h3>Projection Summary</h3>
            <div className="report-box">
              <div className="report-row"><span>title</span><span>{projection?.title || "-"}</span></div>
              <div className="report-row"><span>summary</span><span>{shortText(projection?.summary || "-", 140)}</span></div>
              <div className="report-row"><span>visible</span><span>nodes={projection?.nodes?.length ?? 0}, edges={projection?.edges?.length ?? 0}</span></div>
              <div className="report-row"><span>filtered total</span><span>nodes={projection?.filteredNodeCount ?? 0}, edges={projection?.filteredEdgeCount ?? 0}</span></div>
              <div className="report-row"><span>hidden</span><span>nodes={projection?.hiddenNodeCount ?? 0}, edges={projection?.hiddenEdgeCount ?? 0}</span></div>
            </div>
          </div>

          <div className="card">
            <h3>Representative Paths</h3>
            <ul className="artifacts" style={{ maxHeight: 220 }}>
              {(projection?.representativePaths || []).length === 0 ? (
                <li><span>대표 path 없음</span><span>-</span></li>
              ) : (
                projection.representativePaths.map((path, index) => (
                  <li key={`${path.id}-${index}`} title={path.nodeIds.join(" -> ")}>
                    <span>{shortText(path.label, 48)}</span>
                    <span>{path.nodeIds.length}</span>
                  </li>
                ))
              )}
            </ul>
          </div>

          <div className="card">
            <h3>Selected Node</h3>
            {selectedNode ? (
              <>
                <div className="hint">{selectedNode.id}</div>
                <div className="report-box" style={{ marginTop: 8 }}>
                  <div className="report-row"><span>type / status</span><span><span style={{ color: ontologyNodeTypeColor(selectedNode.type) }}>{selectedNode.type}</span> · <span style={{ color: ontologyStatusColor(selectedNode.status) }}>{selectedNode.status}</span></span></div>
                  <div className="report-row"><span>confidence / degree</span><span>{Number(selectedNode.confidence || 0).toFixed(2)} · {selectedNode.degree}</span></div>
                  <div className="report-row"><span>summary</span><span>{shortText(selectedNode.summary || "-", 140)}</span></div>
                  <div className="report-row"><span>domains</span><span>{(selectedNode.domains || []).join(", ") || "-"}</span></div>
                  <div className="report-row"><span>channels</span><span>{(selectedNode.channels || []).join(", ") || "-"}</span></div>
                  <div className="report-row"><span>actions</span><span>{(selectedNode.actions || []).join(", ") || "-"}</span></div>
                </div>
                {(selectedNode.attributePreview || []).length > 0 ? (
                  <ul className="artifacts" style={{ maxHeight: 160, marginTop: 8 }}>
                    {selectedNode.attributePreview.map((entry) => (
                      <li key={`${selectedNode.id}:${entry.key}`}>
                        <span>{entry.key}</span>
                        <span>{shortText(entry.value, 42)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <div className="hint">노드를 선택하면 상세를 표시한다.</div>
            )}
          </div>

          <div className="card">
            <h3>Adjacency</h3>
            <ul className="artifacts" style={{ maxHeight: 220 }}>
              {adjacentEdges.length === 0 ? (
                <li><span>adjacency 없음</span><span>-</span></li>
              ) : (
                adjacentEdges.map((edge) => (
                  <li key={edge.id} title={`${edge.fromId} -> ${edge.toId}`}>
                    <span>{shortText(edge.type, 18)} · {shortText(edge.fromId, 22)} → {shortText(edge.toId, 22)}</span>
                    <span>{Number(edge.confidence || 0).toFixed(2)}</span>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
