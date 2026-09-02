import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Server } from 'lucide-react';
import PageTopbar from '@/components/PageTopbar';
import { listToolGroups, createToolGroup, updateToolGroup, deleteToolGroup } from '@/api/tool';
import { useToastStore } from '@/stores/toastStore';
import { confirm } from '@/stores/confirmStore';
import type { ToolGroup } from '@/types/tool';
import './SystemListPage.css';

export default function SystemListPage() {
  const [groups, setGroups] = useState<ToolGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ToolGroup | null>(null);
  const [form, setForm] = useState({ name: '', code: '', description: '', icon: 'database' });
  const [showKey, setShowKey] = useState<number | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [guideTab, setGuideTab] = useState<'java' | 'go' | 'python'>('java');
  const navigate = useNavigate();
  const toast = useToastStore((s) => s.show);

  const fetchGroups = useCallback(async () => {
    try {
      const res = await listToolGroups();
      setGroups(res.data);
    } catch {
      toast('加载系统列表失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const handleSubmit = async () => {
    if (!form.name || !form.code) {
      toast('名称和编码为必填项', 'error');
      return;
    }
    try {
      if (editing) {
        await updateToolGroup(editing.id, form);
        toast('更新成功', 'success');
      } else {
        await createToolGroup(form);
        toast('创建成功', 'success');
      }
      setShowForm(false);
      setEditing(null);
      fetchGroups();
    } catch {
      toast('操作失败', 'error');
    }
  };

  const handleDelete = async (group: ToolGroup) => {
    const confirmed = await confirm({
      title: '确认删除',
      message: `确定要删除系统「${group.name}」吗？删除后该系统的所有工具也将无法使用。`,
      confirmText: '删除',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await deleteToolGroup(group.id);
      toast('删除成功', 'success');
      fetchGroups();
    } catch {
      toast('删除失败', 'error');
    }
  };

  const openEdit = (group: ToolGroup) => {
    setEditing(group);
    setForm({ name: group.name, code: group.code, description: group.description || '', icon: group.icon || 'database' });
    setShowForm(true);
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', code: '', description: '', icon: 'database' });
    setShowForm(true);
  };

  if (loading) {
    return <div className="system-list-loading">加载中...</div>;
  }

  return (
    <div className="system-list">
      <PageTopbar
        icon={<Server size={22} />}
        title="系统管理"
        subtitle="管理外部数据系统连接，配置工具组和数据库资源"
        actions={
          <div className="system-list-header-actions">
            <button className="system-list-guide-btn" onClick={() => setShowGuide(true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              使用说明
            </button>
            <button className="system-list-add-btn" onClick={openCreate}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              新建系统
            </button>
          </div>
        }
      />

      <div className="system-list-grid">
        {groups.map((group) => (
          <div key={group.id} className="system-card">
            <div className="system-card-body">
              <h3 className="system-card-name">{group.name}</h3>
              <span className="system-card-code">{group.code}</span>
              <p className="system-card-desc">{group.description || '暂无描述'}</p>
            </div>
            <div className="system-card-actions">
              <button
                className="system-card-btn"
                title="查看工具"
                onClick={() => navigate(`/connect/tools?groupId=${group.id}`)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
              <button className="system-card-btn" title="编辑" onClick={() => openEdit(group)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
              <button
                className="system-card-btn"
                title="查看密钥"
                onClick={() => setShowKey(showKey === group.id ? null : group.id)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                </svg>
              </button>
              <button className="system-card-btn danger" title="删除" onClick={() => handleDelete(group)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </div>
            {showKey === group.id && group.publicKey && (
              <div className="system-card-key">
                <div className="system-card-key-header">
                  <span className="system-card-key-label">公钥</span>
                  <button
                    className="system-card-key-copy"
                    onClick={async () => {
                      await navigator.clipboard.writeText(group.publicKey!);
                      toast('公钥已复制', 'success');
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    复制
                  </button>
                </div>
                <code className="system-card-key-value">{group.publicKey}</code>
              </div>
            )}
          </div>
        ))}
      </div>

      {showForm && (
        <div className="system-form-overlay" onClick={() => setShowForm(false)}>
          <div className="system-form" onClick={(e) => e.stopPropagation()}>
            <h3 className="system-form-title">{editing ? '编辑系统' : '新建系统'}</h3>
            <div className="system-form-field">
              <label className="system-form-label">系统名称</label>
              <input
                className="system-form-input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="如：MES系统"
              />
            </div>
            <div className="system-form-field">
              <label className="system-form-label">系统编码</label>
              <input
                className="system-form-input"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="如：mes"
              />
            </div>
            <div className="system-form-field">
              <label className="system-form-label">描述</label>
              <textarea
                className="system-form-textarea"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="简要描述该系统功能"
                rows={3}
              />
            </div>
            <div className="system-form-actions">
              <button className="system-form-cancel" onClick={() => setShowForm(false)}>取消</button>
              <button className="system-form-submit" onClick={handleSubmit}>
                {editing ? '保存' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showGuide && (
        <GuideModal onClose={() => setShowGuide(false)} tab={guideTab} onTabChange={setGuideTab} />
      )}
    </div>
  );
}

const CODE_SAMPLES: Record<string, string> = {
  java: `// Spring Boot 拦截器示例
import java.security.*;
import java.security.spec.*;
import java.util.Base64;

public class LubanAuditInterceptor implements HandlerInterceptor {

    private static final String LUBAN_PUBLIC_KEY =
        "MCowBQYDK2VwAyEA..."; // 从控制台复制

    private final PublicKey publicKey;

    public LubanAuditInterceptor() throws Exception {
        byte[] keyBytes = Base64.getDecoder().decode(LUBAN_PUBLIC_KEY);
        EdECPublicKeySpec spec = new EdECPublicKeySpec(
            NamedParameterSpec.ED25519, keyBytes);
        this.publicKey = KeyFactory.getInstance("Ed25519")
            .generatePublic(spec);
    }

    @Override
    public boolean preHandle(HttpServletRequest request,
            HttpServletResponse response, Object handler)
            throws Exception {
        String audit = request.getHeader("X-Luban-Audit");
        String sig = request.getHeader("X-Luban-Signature");

        if (audit == null || sig == null) return true; // 非鲁班请求

        // 防重放：5分钟过期
        long ts = parseTimestamp(audit);
        if (Math.abs(System.currentTimeMillis() - ts) > 300_000) {
            response.setStatus(403);
            response.getWriter().write("{\\"error\\":\\"expired\\"}");
            return false;
        }

        // 验证签名
        byte[] sigBytes = Base64.getDecoder()
            .decode(sig.substring(8)); // 去掉 "ed25519=" 前缀
        Signature verifier = Signature.getInstance("Ed25519");
        verifier.initVerify(publicKey);
        verifier.update(audit.getBytes(StandardCharsets.UTF_8));
        if (!verifier.verify(sigBytes)) {
            response.setStatus(403);
            response.getWriter().write("{\\"error\\":\\"invalid signature\\"}");
            return false;
        }

        request.setAttribute("luban_audit", audit);
        return true;
    }
}`,

  go: `// Go HTTP 中间件示例
package middleware

import (
    "crypto/ed25519"
    "encoding/base64"
    "encoding/json"
    "net/http"
    "strings"
    "time"
)

const lubanPublicKey = "MCowBQYDK2VwAyEA..." // 从控制台复制

var pubKey ed25519.PublicKey

func init() {
    keyBytes, _ := base64.StdEncoding.DecodeString(lubanPublicKey)
    pubKey = ed25519.PublicKey(keyBytes)
}

func LubanAuditMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        audit := r.Header.Get("X-Luban-Audit")
        sig := r.Header.Get("X-Luban-Signature")

        if audit == "" || sig == "" {
            next.ServeHTTP(w, r)
            return
        }

        // 防重放：5分钟过期
        var auditData struct { Ts int64 \`json:"ts"\` }
        json.Unmarshal([]byte(audit), &auditData)
        if time.Now().UnixMilli()-auditData.Ts > 300_000 {
            http.Error(w, \`{"error":"expired"}\`, 403)
            return
        }

        // 验证签名
        sigBytes, _ := base64.StdEncoding.DecodeString(
            strings.TrimPrefix(sig, "ed25519="))
        if !ed25519.Verify(pubKey, []byte(audit), sigBytes) {
            http.Error(w, \`{"error":"invalid signature"}\`, 403)
            return
        }

        r.Header.Set("X-Luban-Audit-Verified", "true")
        next.ServeHTTP(w, r)
    })
}`,

  python: `# Python Flask / FastAPI 中间件示例
from cryptography.hazmat.primitives.asymmetric import ed25519
from cryptography.exceptions import InvalidSignature
import base64, json, time

LUBAN_PUBLIC_KEY = "MCowBQYDK2VwAyEA..."  # 从控制台复制

pub_key = ed25519.Ed25519PublicKey.from_public_bytes(
    base64.b64decode(LUBAN_PUBLIC_KEY)
)

def verify_luban_audit(headers):
    audit = headers.get("X-Luban-Audit")
    sig = headers.get("X-Luban-Signature")

    if not audit or not sig:
        return None  # 非鲁班请求，走原有认证

    # 防重放：5分钟过期
    audit_data = json.loads(audit)
    if time.time() * 1000 - audit_data["ts"] > 300_000:
        return False  # 请求过期

    # 验证签名
    signature = base64.b64decode(sig.replace("ed25519=", ""))
    try:
        pub_key.verify(signature, audit.encode("utf-8"))
        return True  # 签名验证通过
    except InvalidSignature:
        return False  # 签名无效
`,
};

const TAB_LABELS: Record<string, string> = { java: 'Java', go: 'Go', python: 'Python' };

interface GuideModalProps {
  onClose: () => void;
  tab: string;
  onTabChange: (tab: 'java' | 'go' | 'python') => void;
}

function GuideModal({ onClose, tab, onTabChange }: GuideModalProps) {
  return (
    <div className="guide-overlay" onClick={onClose}>
      <div className="guide-modal" onClick={(e) => e.stopPropagation()}>
        <div className="guide-header">
          <h3 className="guide-title">系统接入指南</h3>
          <button className="guide-close" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="guide-body">
          <div className="guide-section">
            <h4 className="guide-section-title">认证原理</h4>
            <p className="guide-text">
              鲁班使用 <strong>Ed25519 公私钥签名</strong> 完成认证。创建系统时自动生成公私钥对：
            </p>
            <ul className="guide-list">
              <li><strong>私钥</strong>：保留在鲁班服务端，AES-256 加密存储，用于对请求签名</li>
              <li><strong>公钥</strong>：在系统卡片中展示，需复制到本地系统用于验证签名</li>
            </ul>
            <p className="guide-text">
              鲁班调用您的系统 API 时，会在请求头中注入 <code>X-Luban-Audit</code>（审计信息，含时间戳）和
              <code>X-Luban-Signature</code>（用私钥对审计信息签名）。您的系统用公钥验证签名即可确认请求来自鲁班，无需额外的 API Key 或 Token。
            </p>
          </div>

          <div className="guide-section">
            <h4 className="guide-section-title">接入步骤</h4>
            <ol className="guide-list">
              <li>在系统卡片中点击「查看密钥」，获取公钥</li>
              <li>将公钥作为配置项添加到本地系统</li>
              <li>在网关或中间件中加入签名验证代码（下方示例）</li>
              <li>验证通过 = 请求来自鲁班 = 认证通过</li>
            </ol>
          </div>

          <div className="guide-section">
            <h4 className="guide-section-title">签名验证代码</h4>
            <div className="guide-tabs">
              {(['java', 'go', 'python'] as const).map((t) => (
                <button
                  key={t}
                  className={`guide-tab ${tab === t ? 'active' : ''}`}
                  onClick={() => onTabChange(t)}
                >
                  {TAB_LABELS[t]}
                </button>
              ))}
            </div>
            <pre className="guide-code"><code>{CODE_SAMPLES[tab]}</code></pre>
          </div>
        </div>
      </div>
    </div>
  );
}