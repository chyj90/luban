import { useState, useEffect, useCallback } from 'react';
import { getSystemPermissions, applySystemPermission, listMyPermissions } from '@/api/tool';
import { useToastStore } from '@/stores/toastStore';
import type { SystemWithPerm, SystemPermission } from '@/types/tool';
import './SystemPermissionPage.css';

export default function SystemPermissionPage() {
  const [systems, setSystems] = useState<SystemWithPerm[]>([]);
  const [myPerms, setMyPerms] = useState<SystemPermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [showApply, setShowApply] = useState(false);
  const [applyGroupId, setApplyGroupId] = useState<number>(0);
  const [reason, setReason] = useState('');
  const [activeTab, setActiveTab] = useState<'systems' | 'my'>('systems');
  const toast = useToastStore((s) => s.add);

  const fetchData = useCallback(async () => {
    try {
      const [sysRes, myRes] = await Promise.all([
        getSystemPermissions(),
        listMyPermissions(),
      ]);
      setSystems(sysRes.data);
      setMyPerms(myRes.data);
    } catch {
      toast('加载数据失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleApply = async () => {
    if (!applyGroupId || !reason.trim()) {
      toast('请选择系统和申请原因', 'error');
      return;
    }
    try {
      await applySystemPermission(applyGroupId, reason);
      toast('申请已提交', 'success');
      setShowApply(false);
      setReason('');
      fetchData();
    } catch {
      toast('申请失败', 'error');
    }
  };

  const openApply = (groupId: number) => {
    setApplyGroupId(groupId);
    setReason('');
    setShowApply(true);
  };

  const STATUS_LABEL: Record<string, { label: string; className: string }> = {
    NONE: { label: '未申请', className: 'none' },
    PENDING: { label: '审批中', className: 'pending' },
    APPROVED: { label: '已获批', className: 'approved' },
    REJECTED: { label: '已驳回', className: 'rejected' },
  };

  if (loading) {
    return <div className="sys-perm-loading">加载中...</div>;
  }

  return (
    <div className="sys-perm">
      <h2 className="sys-perm-title">系统权限</h2>

      <div className="sys-perm-tabs">
        <button
          className={`sys-perm-tab ${activeTab === 'systems' ? 'active' : ''}`}
          onClick={() => setActiveTab('systems')}
        >
          系统列表
        </button>
        <button
          className={`sys-perm-tab ${activeTab === 'my' ? 'active' : ''}`}
          onClick={() => setActiveTab('my')}
        >
          我的申请
        </button>
      </div>

      {activeTab === 'systems' && (
        <div className="sys-perm-grid">
          {systems.map((sys) => {
            const status = STATUS_LABEL[sys.status] ?? STATUS_LABEL.NONE;
            return (
              <div key={sys.groupId} className="sys-perm-card">
                <div className="sys-perm-card-header">
                  <h3 className="sys-perm-card-name">{sys.name}</h3>
                  <span className={`sys-perm-card-status ${status.className}`}>{status.label}</span>
                </div>
                <p className="sys-perm-card-desc">{sys.description || '暂无描述'}</p>
                <span className="sys-perm-card-code">{sys.code}</span>
                <div className="sys-perm-card-actions">
                  {sys.status === 'NONE' && (
                    <button className="sys-perm-card-btn primary" onClick={() => openApply(sys.groupId)}>申请权限</button>
                  )}
                  {sys.status === 'REJECTED' && (
                    <div>
                      <div className="sys-perm-card-reject-reason">驳回原因：{sys.rejectReason}</div>
                      <button className="sys-perm-card-btn primary" onClick={() => openApply(sys.groupId)}>重新申请</button>
                    </div>
                  )}
                  {sys.status === 'APPROVED' && (
                    <span className="sys-perm-card-approved-hint">已具备访问权限</span>
                  )}
                  {sys.status === 'PENDING' && (
                    <span className="sys-perm-card-pending-hint">等待审批中...</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activeTab === 'my' && (
        <div className="sys-perm-table-wrap">
          <table className="sys-perm-table">
            <thead>
              <tr>
                <th>系统</th>
                <th>申请原因</th>
                <th>状态</th>
                <th>申请时间</th>
                <th>审批时间</th>
              </tr>
            </thead>
            <tbody>
              {myPerms.length === 0 ? (
                <tr>
                  <td colSpan={5} className="sys-perm-empty">暂无申请记录</td>
                </tr>
              ) : (
                myPerms.map((perm) => {
                  const status = STATUS_LABEL[perm.status] ?? STATUS_LABEL.NONE;
                  return (
                    <tr key={perm.id}>
                      <td className="sys-perm-table-name">{perm.groupName}</td>
                      <td>{perm.reason || '-'}</td>
                      <td>
                        <span className={`sys-perm-table-status ${status.className}`}>{status.label}</span>
                      </td>
                      <td>{perm.createdAt ? new Date(perm.createdAt).toLocaleString() : '-'}</td>
                      <td>{perm.approvedAt ? new Date(perm.approvedAt).toLocaleString() : '-'}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {showApply && (
        <div className="sys-perm-overlay" onClick={() => setShowApply(false)}>
          <div className="sys-perm-form" onClick={(e) => e.stopPropagation()}>
            <h3 className="sys-perm-form-title">申请系统权限</h3>
            <div className="sys-perm-form-field">
              <label>申请系统</label>
              <select value={applyGroupId} onChange={(e) => setApplyGroupId(Number(e.target.value))}>
                <option value={0}>请选择系统</option>
                {systems.filter((s) => s.status === 'NONE' || s.status === 'REJECTED').map((s) => (
                  <option key={s.groupId} value={s.groupId}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="sys-perm-form-field">
              <label>申请原因</label>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="请说明申请该系统的原因" rows={3} />
            </div>
            <div className="sys-perm-form-actions">
              <button className="sys-perm-form-cancel" onClick={() => setShowApply(false)}>取消</button>
              <button className="sys-perm-form-submit" onClick={handleApply}>提交申请</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}