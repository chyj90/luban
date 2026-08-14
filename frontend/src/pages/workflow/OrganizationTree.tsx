import { useState } from 'react';
import type { Department } from '../../types/workflow';
import styles from './OrganizationTree.module.css';

interface OrganizationTreeProps {
  departments: Department[];
  selectedId?: number;
  onSelect: (dept: Department) => void;
}

interface TreeNodeProps {
  node: Department;
  children: Department[];
  allDepartments: Department[];
  selectedId?: number;
  onSelect: (dept: Department) => void;
  level: number;
}

function TreeNode({ node, children, allDepartments, selectedId, onSelect, level }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(level < 1);
  const hasChildren = children.length > 0;

  const grandchildren = hasChildren
    ? allDepartments.filter((d) => d.parentId === node.id)
    : [];

  return (
    <div className={styles.treeNode}>
      <div
        className={`${styles.nodeRow} ${selectedId === node.id ? styles.nodeRowSelected : ''}`}
        style={{ paddingLeft: `${level * 16}px` }}
        onClick={() => onSelect(node)}
      >
        {hasChildren ? (
          <span
            className={`${styles.expandIcon} ${expanded ? styles.expandIconOpen : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            ▶
          </span>
        ) : (
          <span className={styles.leafIcon}>·</span>
        )}
        <span className={styles.nodeIcon}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 21h18"/><path d="M3 10h18"/><path d="M5 6l7-3 7 3"/><path d="M4 10v11"/><path d="M20 10v11"/><path d="M8 14v3"/><path d="M12 14v3"/><path d="M16 14v3"/></svg>
        </span>
        <span className={styles.nodeName}>{node.name}</span>
        {hasChildren && (
          <span className={styles.nodeCount}>({children.length})</span>
        )}
      </div>
      {expanded && hasChildren && (
        <div className={styles.children}>
          {grandchildren.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              children={allDepartments.filter((d) => d.parentId === child.id)}
              allDepartments={allDepartments}
              selectedId={selectedId}
              onSelect={onSelect}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function OrganizationTree({ departments, selectedId, onSelect }: OrganizationTreeProps) {
  const rootNodes = departments.filter((d) => !d.parentId || d.parentId === 0);

  if (departments.length === 0) {
    return (
      <div className={styles.empty}>
        <span>暂无组织数据</span>
      </div>
    );
  }

  return (
    <div className={styles.tree}>
      {rootNodes.length > 0 ? (
        rootNodes.map((root) => (
          <TreeNode
            key={root.id}
            node={root}
            children={departments.filter((d) => d.parentId === root.id)}
            allDepartments={departments}
            selectedId={selectedId}
            onSelect={onSelect}
            level={0}
          />
        ))
      ) : (
        departments.map((dept) => (
          <TreeNode
            key={dept.id}
            node={dept}
            children={departments.filter((d) => d.parentId === dept.id)}
            allDepartments={departments}
            selectedId={selectedId}
            onSelect={onSelect}
            level={0}
          />
        ))
      )}
    </div>
  );
}