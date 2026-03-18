"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  buildOntologyEdgePath,
  buildOntologyRenderableGraph
} from "../lib/ontology-graph-layout.js";

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
  const [focusMode, setFocusMode] = useState("path");
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [selectedPathId, setSelectedPathId] = useState("");
  const [selectedComponentId, setSelectedComponentId] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState("");

  async function loadOntologyView(options = {}) {
    if (!projectId) return;
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams();
      const nextProjectionId = options.projectionId ?? projectionId;
      const nextNodeType = options.nodeType ?? nodeTypeFilter;
      const nextFocusMode = options.focusMode ?? focusMode;
      const nextSelectedPathId = options.selectedPathId ?? selectedPathId;
      const nextSelectedComponentId = options.selectedComponentId ?? selectedComponentId;
      const nextSearch = options.search ?? appliedSearch;
      if (nextProjectionId) query.set("projectionId", nextProjectionId);
      if (nextNodeType && nextNodeType !== "all") query.set("nodeType", nextNodeType);
      if (nextFocusMode) query.set("focusMode", nextFocusMode);
      if (nextSelectedPathId) query.set("selectedPathId", nextSelectedPathId);
      if (nextSelectedComponentId) query.set("selectedComponentId", nextSelectedComponentId);
      if (nextSearch && String(nextSearch).trim()) query.set("search", String(nextSearch).trim());
      query.set("nodeLimit", String(options.nodeLimit ?? 180));
      query.set("edgeLimit", String(options.edgeLimit ?? 360));
      const response = await getJson(`/api/projects/${projectId}/ontology?${query.toString()}`);
      setOntologyViewData(response);
      setProjectionId(response?.ontology?.filters?.selectedProjectionId || nextProjectionId || "projection:front-back-flow");
      setFocusMode(response?.ontology?.filters?.focusMode || nextFocusMode || "path");
      setSelectedPathId(response?.ontology?.filters?.selectedPathId || "");
      setSelectedComponentId(response?.ontology?.filters?.selectedComponentId || "");
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
  const renderableGraph = useMemo(
    () =>
      buildOntologyRenderableGraph({
        nodes: projection?.nodes || [],
        edges: projection?.edges || [],
        representativePaths: projection?.representativePaths || [],
        selectedPathId,
        focusMode
      }),
    [focusMode, projection?.edges, projection?.nodes, projection?.representativePaths, selectedPathId]
  );
  const layout = renderableGraph.layout;

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
              setSelectedPathId("");
              setSelectedComponentId("");
              setSelectedNodeId("");
              void loadOntologyView({ projectionId: value, nodeType: nodeTypeFilter, focusMode, selectedPathId: "", selectedComponentId: "", search: appliedSearch });
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
              void loadOntologyView({ projectionId, nodeType: value, focusMode, selectedPathId, selectedComponentId, search: appliedSearch });
            }}
            disabled={loading}
            style={{ minWidth: 180, width: "auto" }}
          >
            <option value="all">all node types</option>
            {(projection?.availableNodeTypes || []).map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          <select
            value={focusMode}
            onChange={(e) => {
              const value = e.target.value;
              setFocusMode(value);
              if (value !== "path") setSelectedPathId("");
              if (value !== "component") setSelectedComponentId("");
              setSelectedNodeId("");
              void loadOntologyView({
                projectionId,
                nodeType: nodeTypeFilter,
                focusMode: value,
                selectedPathId: value === "path" ? selectedPathId : "",
                selectedComponentId: value === "component" ? selectedComponentId : "",
                search: appliedSearch
              });
            }}
            disabled={loading}
            style={{ minWidth: 180, width: "auto" }}
          >
            <option value="path">대표 path 중심</option>
            <option value="component">구조 컴포넌트 중심</option>
            <option value="projection">전체 projection</option>
          </select>
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="node/path/action 검색" style={{ flex: 1 }} />
          <button type="button" className="secondary" onClick={() => { setAppliedSearch(searchInput.trim()); setSelectedNodeId(""); void loadOntologyView({ projectionId, nodeType: nodeTypeFilter, focusMode, selectedPathId, selectedComponentId, search: searchInput.trim() }); }} disabled={loading} style={{ width: "auto" }}>
            적용
          </button>
          <button type="button" className="secondary" onClick={() => { setSearchInput(""); setAppliedSearch(""); setNodeTypeFilter("all"); setSelectedNodeId(""); void loadOntologyView({ projectionId, nodeType: "all", focusMode, selectedPathId, selectedComponentId, search: "" }); }} disabled={loading} style={{ width: "auto" }}>
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
              <defs>
                <pattern id="ontology-grid-full" width="28" height="28" patternUnits="userSpaceOnUse">
                  <circle cx="2" cy="2" r="1.2" fill="#dbe4f0" />
                </pattern>
                <marker id="ontology-arrow-full" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="strokeWidth">
                  <path d="M0,0 L10,5 L0,10 z" fill="#94a3b8" />
                </marker>
              </defs>
              <rect x="0" y="0" width={layout.width} height={layout.height} fill="#f8fafc" />
              <rect x="0" y="0" width={layout.width} height={layout.height} fill="url(#ontology-grid-full)" opacity="0.7" />
              {layout.mode === "path" ? (
                <>
                  <line
                    x1="90"
                    y1={430}
                    x2={layout.width - 90}
                    y2={430}
                    stroke="#cbd5e1"
                    strokeDasharray="8 10"
                    strokeWidth={2}
                  />
                  <text x="92" y="404" fontSize="12" fill="#64748b">canonical path spine</text>
                </>
              ) : null}
              {(layout.lanes || []).map((lane) => (
                <g key={`lane:${lane.key}`}>
                  <line
                    x1={lane.x}
                    y1={28}
                    x2={lane.x}
                    y2={layout.height - 24}
                    stroke="#e2e8f0"
                    strokeDasharray="4 8"
                    strokeWidth={1}
                  />
                  <text x={lane.x} y={18} textAnchor="middle" fontSize="12" fill="#64748b">{lane.label}</text>
                </g>
              ))}
              {renderableGraph.edges.map((edge) => {
                const from = layout.positions[edge.fromId];
                const to = layout.positions[edge.toId];
                if (!from || !to) return null;
                const selected = selectedNode && (edge.fromId === selectedNode.id || edge.toId === selectedNode.id);
                const isSpineEdge = layout.pathNodeIds?.has(edge.fromId) && layout.pathNodeIds?.has(edge.toId);
                return (
                  <path
                    key={edge.id}
                    d={buildOntologyEdgePath(edge, layout)}
                    fill="none"
                    stroke={selected ? "#0f172a" : isSpineEdge ? "#334155" : edge.isHighlighted ? "#64748b" : "#cbd5e1"}
                    strokeWidth={selected ? 2.8 : isSpineEdge ? 2.2 : edge.isHighlighted ? 1.8 : 1.25}
                    opacity={selected ? 0.95 : isSpineEdge ? 0.92 : edge.isHighlighted ? 0.82 : 0.62}
                    markerEnd="url(#ontology-arrow-full)"
                  />
                );
              })}
              {renderableGraph.nodes.map((node) => {
                const position = layout.positions[node.id];
                if (!position) return null;
                const selected = selectedNode?.id === node.id;
                const onSpine = layout.pathNodeIds?.has(node.id);
                return (
                  <g key={node.id} transform={`translate(${position.x}, ${position.y})`} onClick={() => setSelectedNodeId(node.id)} style={{ cursor: "pointer" }}>
                    <circle r={selected ? 22 : onSpine ? 19 : 16} fill={ontologyNodeTypeColor(node.type)} opacity={node.isHighlighted ? 0.96 : 0.84} stroke={selected ? "#0f172a" : onSpine ? "#334155" : node.isHighlighted ? "#1e293b" : "#cbd5e1"} strokeWidth={selected ? 3 : onSpine ? 2.2 : 1.5} />
                    <rect x={-74} y={selected ? 26 : 24} width="148" height="24" rx="10" fill="rgba(248,250,252,0.96)" stroke={selected ? "#94a3b8" : "#dbe4f0"} />
                    <text x="0" y={selected ? 42 : 40} textAnchor="middle" fontSize="12" fill="#0f172a">{shortText(node.label, 26)}</text>
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
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setFocusMode("path");
                        setSelectedPathId(path.id);
                        setSelectedComponentId("");
                        setSelectedNodeId(path.nodeIds[0] || "");
                        void loadOntologyView({ projectionId, nodeType: nodeTypeFilter, focusMode: "path", selectedPathId: path.id, selectedComponentId: "", search: appliedSearch });
                      }}
                      style={{
                        width: "100%",
                        display: "inline-flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        textAlign: "left",
                        background: selectedPathId === path.id ? "rgba(99,102,241,0.12)" : undefined,
                        borderColor: selectedPathId === path.id ? "#6366f1" : undefined
                      }}
                    >
                      <span>{shortText(path.label, 48)}</span>
                      <span>{path.nodeIds.length}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>

          <div className="card">
            <h3>Components</h3>
            <ul className="artifacts" style={{ maxHeight: 220 }}>
              {(projection?.components || []).length === 0 ? (
                <li><span>component 없음</span><span>-</span></li>
              ) : (
                projection.components.map((component) => (
                  <li key={component.id} title={component.label}>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setFocusMode("component");
                        setSelectedComponentId(component.id);
                        setSelectedNodeId("");
                        void loadOntologyView({ projectionId, nodeType: nodeTypeFilter, focusMode: "component", selectedPathId: "", selectedComponentId: component.id, search: appliedSearch });
                      }}
                      style={{
                        width: "100%",
                        display: "inline-flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        textAlign: "left",
                        background: selectedComponentId === component.id ? "rgba(14,165,233,0.12)" : undefined,
                        borderColor: selectedComponentId === component.id ? "#0ea5e9" : undefined
                      }}
                    >
                      <span>{shortText(component.label, 44)}</span>
                      <span>{component.nodeCount}/{component.edgeCount}</span>
                    </button>
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
