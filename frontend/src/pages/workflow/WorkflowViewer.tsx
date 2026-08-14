import { useMemo } from 'react';
import type { WorkflowNode, WorkflowEdge } from '../../types/workflow';
import styles from './WorkflowViewer.module.css';

interface WorkflowViewerProps {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  currentNodeId?: string;
  history?: { nodeId: string; status: string }[];
  width?: number;
  height?: number;
}

const NODE_COLORS: Record<string, string> = {
  start: '#52c41a',
  approval: '#1890ff',
  condition: '#fa8c16',
  parallel: '#722ed1',
  sub_process: '#8c8c8c',
  end: '#ff4d4f',
  cc: '#13c2c2',
};

const NODE_ICONS: Record<string, string> = {
  start: '>',
  approval: 'A',
  condition: '<>',
  parallel: '||',
  sub_process: '>',
  end: 'O',
  cc: 'CC',
};

export default function WorkflowViewer({
  nodes,
  edges,
  currentNodeId,
  history = [],
  width = 800,
  height = 500,
}: WorkflowViewerProps) {
  const completedNodeIds = useMemo(
    () => new Set(history.filter((h) => h.status === 'COMPLETED').map((h) => h.nodeId)),
    [history],
  );

  const activeNodeIds = useMemo(
    () => new Set(history.filter((h) => h.status === 'ACTIVE').map((h) => h.nodeId)),
    [history],
  );

  const nodeMap = useMemo(() => {
    const map = new Map<string, WorkflowNode>();
    nodes.forEach((n) => map.set(n.nodeId, n));
    return map;
  }, [nodes]);

  const layout = useMemo(() => {
    if (nodes.length === 0) return { nodePositions: new Map<string, { x: number; y: number }>(), connections: [] };

    const positions = new Map<string, { x: number; y: number }>();
    const startNode = nodes.find((n) => n.nodeType === 'start');
    const endNode = nodes.find((n) => n.nodeType === 'end');

    if (startNode) {
      positions.set(startNode.nodeId, { x: width / 2 - 60, y: 30 });

      const queue = [startNode.nodeId];
      const visited = new Set<string>();
      let currentY = 120;

      while (queue.length > 0) {
        const currentId = queue.shift()!;
        if (visited.has(currentId)) continue;
        visited.add(currentId);

        const outEdges = edges.filter((e) => e.source === currentId);
        const children = outEdges.map((e) => e.target);

        const childCount = children.length;
        children.forEach((childId, idx) => {
          if (!positions.has(childId)) {
            const x = childCount === 1
              ? width / 2 - 60
              : width / 2 - 60 + (idx - (childCount - 1) / 2) * 180;
            positions.set(childId, { x, y: currentY });
          }
          if (!visited.has(childId)) {
            queue.push(childId);
          }
        });

        if (childCount > 0) {
          currentY += 100;
        }
      }
    }

    if (endNode && !positions.has(endNode.nodeId)) {
      const maxY = Math.max(...Array.from(positions.values()).map((p) => p.y), 120);
      positions.set(endNode.nodeId, { x: width / 2 - 60, y: maxY + 100 });
    }

    nodes.forEach((n) => {
      if (!positions.has(n.nodeId)) {
        positions.set(n.nodeId, { x: width / 2 - 60, y: height / 2 });
      }
    });

    return { nodePositions: positions, connections: edges };
  }, [nodes, edges, width, height]);

  const getNodeStatus = (nodeId: string) => {
    if (activeNodeIds.has(nodeId) || nodeId === currentNodeId) return 'active';
    if (completedNodeIds.has(nodeId)) return 'completed';
    return 'pending';
  };

  return (
    <div className={styles.viewer} style={{ width, height }}>
      <svg width={width} height={height} className={styles.svg}>
        {layout.connections.map((edge) => {
          const from = layout.nodePositions.get(edge.source);
          const to = layout.nodePositions.get(edge.target);
          if (!from || !to) return null;
          return (
            <line
              key={edge.id}
              x1={from.x + 60}
              y1={from.y + 36}
              x2={to.x + 60}
              y2={to.y}
              stroke="#d9d9d9"
              strokeWidth={2}
              markerEnd="url(#arrowhead)"
            />
          );
        })}

        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="#d9d9d9" />
          </marker>
        </defs>

        {Array.from(layout.nodePositions.entries()).map(([nodeId, pos]) => {
          const node = nodeMap.get(nodeId);
          if (!node) return null;
          const status = getNodeStatus(nodeId);
          const color = NODE_COLORS[node.nodeType] || '#8c8c8c';
            const icon = NODE_ICONS[node.nodeType] || '';

          return (
            <g key={nodeId}>
              <rect
                x={pos.x}
                y={pos.y}
                width={120}
                height={36}
                rx={node.nodeType === 'start' || node.nodeType === 'end' ? 18 : 8}
                fill={status === 'active' ? '#e6f7ff' : status === 'completed' ? '#f6ffed' : '#fff'}
                stroke={status === 'active' ? '#1890ff' : status === 'completed' ? '#52c41a' : color}
                strokeWidth={status === 'active' ? 2.5 : 1.5}
                strokeDasharray={status === 'pending' ? '5,3' : 'none'}
              />
              <text
                x={pos.x + 60}
                y={pos.y + 22}
                textAnchor="middle"
                fontSize={12}
                fill={status === 'pending' ? '#999' : '#333'}
                fontWeight={status === 'active' ? 600 : 400}
              >
                {icon} {node.nodeName}
              </text>
            </g>
          );
        })}
      </svg>

      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.legendDot} style={{ background: '#52c41a' }} /> 已完成
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendDot} style={{ background: '#1890ff' }} /> 当前节点
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendDot} style={{ background: '#d9d9d9' }} /> 未到达
        </span>
      </div>
    </div>
  );
}