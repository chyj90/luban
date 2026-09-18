import { useEffect, useState } from 'react';
import { getSystemPermissions, applySystemPermission } from '@/api/tool';
import { useToastStore } from '@/stores/toastStore';
import type { SystemWithPerm } from '@/types/tool';
import './ApplySystemAccessModal.css';

interface ApplySystemAccessModalProps {
  onClose: () => void;
  /** 申请提交成功后回调（刷新外层资源清单） */
  onApplied?: () => void;
}

const STATUS_LABEL: Record<SystemWithPerm['status'], { text: string; color: string; bg: string }> = {
  APPROVED: { text: '已授权', color: '#389e0d', bg: '#f6ffed' },
  PENDING: { text: '审批中', color: '#d48806', bg: '#fffbe6' },
  REJECTED: { text: '已驳回', color: '#cf1322', bg: '#fff1f0' },
  NONE: { text: '未申请', color: '#8c8c8c', bg: '#f5f5f5' },
};

/**
 * 申请平台数据源：按"系统"申请访问权限（复用平台系统权限审批流）。
 * 审批通过后，该系统下的平台数据源在应用侧可见、可执行 SQL 与测试。
 */
export function ApplySystemAccessModal({ onClose, onApplied }: ApplySystemAccessModalProps) {
  const toast = useToastStore((s) => s.show);
  const [systems, setSystems] = useState<SystemWithPerm[]>([]);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState('');
  const [applyingId, setApplyingId] = useState<number | null>(null);

  const load = () => {
    getSystemPermissions()
      .then((res) => setSystems(res.data || []))
      .catch(() => setSystems([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleApply = async (sys: SystemWithPerm) => {
    if (!reason.trim()) {
      toast('请填写申请理由', 'error');
      return;
    }
    setApplyingId(sys.groupId);
    try {
      const res = await applySystemPermission(sys.groupId, reason.trim());
      const data = res.data as Record<string, unknown>;
      if (data && data.error) {
        toast(String(data.error), 'error');
        return;
      }
      if (data && data.status === 'APPROVED') {
        toast('已直接授权（超管无需审批）', 'success');
      } else {
        toast('申请已提交，等待审批（可在工作中心查看进度）', 'success');
      }
      load();
      onApplied?.();
    } catch (e: unknown) {
      toast((e as Error)?.message || '申请失败', 'error');
    } finally {
      setApplyingId(null);
    }
  };

  return (
    <div className="apply-ds-overlay" onClick={onClose}>
      <div className="apply-ds-modal" onClick={(e) => e.stopPropagation()}>
        <div className="apply-ds-header">
          <span className="apply-ds-title">申请平台系统权限</span>
          <button className="apply-ds-close" onClick={onClose}>×</button>
        </div>
        <div className="apply-ds-body">
          <p className="apply-ds-hint">
            平台资产按系统授权：申请通过某个系统的访问权限后，该系统下的数据源（可执行 SQL/测试）
            与 API 工具（可调用）即可在本应用中使用；平台侧资产不可编辑删除。审批流程走工作中心。
          </p>
          <label className="apply-ds-label">申请理由</label>
          <textarea
            className="apply-ds-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="如：订单看板应用需要读取订单系统的数据"
          />
          <label className="apply-ds-label">可申请的系统（通过后其数据源与 API 一并可用）</label>
          {loading ? (
            <div className="apply-ds-empty">加载中...</div>
          ) : systems.length === 0 ? (
            <div className="apply-ds-empty">平台还没有接入任何系统，请先到「建模中心 → 系统管理」接入。</div>
          ) : (
            <div className="apply-ds-list">
              {systems.map((sys) => {
                const st = STATUS_LABEL[sys.status] || STATUS_LABEL.NONE;
                return (
                  <div key={sys.groupId} className="apply-ds-item">
                    <div className="apply-ds-item-main">
                      <span className="apply-ds-item-name">{sys.name}</span>
                      {sys.description && <span className="apply-ds-item-desc">{sys.description}</span>}
                    </div>
                    <div className="apply-ds-item-side">
                      <span
                        className="apply-ds-status"
                        style={{ color: st.color, background: st.bg }}
                        title={sys.status === 'REJECTED' && sys.rejectReason ? `驳回原因：${sys.rejectReason}` : undefined}
                      >
                        {st.text}
                      </span>
                      {(sys.status === 'NONE' || sys.status === 'REJECTED') && (
                        <button
                          className="apply-ds-btn"
                          onClick={() => handleApply(sys)}
                          disabled={applyingId === sys.groupId}
                        >
                          {applyingId === sys.groupId ? '提交中...' : '申请'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
