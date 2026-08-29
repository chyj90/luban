import { useState, useEffect, useRef } from 'react';
import { fetchBuiltinRelationTypes } from '@/api/concept';
import type { RelationTypeMeta } from '@/types/concept';

let cachedTypes: RelationTypeMeta[] | null = null;
let cachedLabels: Record<string, string> | null = null;
let cachedColors: Record<string, string> | null = null;
let cachedSourceToTarget: Record<string, boolean> | null = null;
let cachedSourceRoles: Record<string, string> | null = null;
let cachedTargetRoles: Record<string, string> | null = null;
let cachedSymmetricTypes: Set<string> | null = null;

export function useRelationTypes() {
  const [loading, setLoading] = useState(!cachedTypes);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (cachedTypes) {
      setLoading(false);
      return;
    }
    fetchBuiltinRelationTypes()
      .then((res) => {
        if (!mountedRef.current) return;
        cachedTypes = res.data || [];
        cachedLabels = {};
        cachedColors = {};
        cachedSourceToTarget = {};
        cachedSourceRoles = {};
        cachedTargetRoles = {};
        cachedSymmetricTypes = new Set();
        for (const t of cachedTypes) {
          cachedLabels[t.name] = t.label || t.name;
          cachedColors[t.name] = t.color || '#999';
          cachedSourceToTarget[t.name] = t.sourceToTarget;
          cachedSourceRoles[t.name] = t.sourceRole || '';
          cachedTargetRoles[t.name] = t.targetRole || '';
          if (t.symmetric) cachedSymmetricTypes.add(t.name);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!mountedRef.current) return;
        cachedLabels = {};
        cachedColors = {};
        cachedSourceToTarget = {};
        cachedSourceRoles = {};
        cachedTargetRoles = {};
        cachedSymmetricTypes = new Set();
        setLoading(false);
      });
    return () => { mountedRef.current = false; };
  }, []);

  return {
    types: cachedTypes || [],
    labels: cachedLabels || {},
    colors: cachedColors || {},
    sourceToTarget: cachedSourceToTarget || {},
    sourceRoles: cachedSourceRoles || {},
    targetRoles: cachedTargetRoles || {},
    isSymmetric: (type: string) => cachedSymmetricTypes?.has(type) || false,
    loading,
  };
}