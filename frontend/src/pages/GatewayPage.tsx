import { useState, useEffect, useCallback } from 'react';
import { Activity, Server, Users, Zap, Clock, RefreshCw } from 'lucide-react';
import { useToastStore } from '@/stores/toastStore';
import './GatewayPage.css';

interface GatewayStats {
  endpointStatus: string;
  activeSessions: number;
  totalRequests: number;
  avgResponseTime: number;
  uptime: string;
  lastRequest: string;
}

export default function GatewayPage() {
  const [stats, setStats] = useState<GatewayStats>({
    endpointStatus: 'running',
    activeSessions: 0,
    totalRequests: 0,
    avgResponseTime: 0,
    uptime: '--',
    lastRequest: '--',
  });
  const [loading, setLoading] = useState(true);
  const toast = useToastStore((s) => s.add);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/mcp/health');
      if (res.ok) {
        const data = await res.json() as GatewayStats;
        setStats(data);
      } else {
        setStats((prev) => ({ ...prev, endpointStatus: 'error' }));
      }
    } catch {
      setStats((prev) => ({ ...prev, endpointStatus: 'error' }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  const handleRefresh = () => {
    setLoading(true);
    fetchStats();
    toast('已刷新', 'success');
  };

  const statusColor = stats.endpointStatus === 'running' ? '#52c41a' : '#ff4d4f';
  const statusLabel = stats.endpointStatus === 'running' ? '运行中' : '异常';

  if (loading) {
    return <div className="gateway-loading">加载中...</div>;
  }

  return (
    <div className="gateway">
      <div className="gateway-header">
        <div className="gateway-header-left">
          <Server size={20} />
          <h2>MCP 网关</h2>
        </div>
        <button className="gateway-refresh-btn" onClick={handleRefresh}>
          <RefreshCw size={14} />
          刷新
        </button>
      </div>

      <div className="gateway-status-bar">
        <div className="gateway-status-dot" style={{ background: statusColor }} />
        <span className="gateway-status-text">{statusLabel}</span>
        <span className="gateway-status-divider">|</span>
        <Clock size={14} />
        <span className="gateway-status-text">运行时间: {stats.uptime}</span>
      </div>

      <div className="gateway-cards">
        <div className="gateway-card">
          <div className="gateway-card-icon gateway-card-icon--blue">
            <Activity size={20} />
          </div>
          <div className="gateway-card-info">
            <span className="gateway-card-label">活跃会话</span>
            <span className="gateway-card-value">{stats.activeSessions}</span>
          </div>
        </div>
        <div className="gateway-card">
          <div className="gateway-card-icon gateway-card-icon--green">
            <Zap size={20} />
          </div>
          <div className="gateway-card-info">
            <span className="gateway-card-label">总请求数</span>
            <span className="gateway-card-value">{stats.totalRequests.toLocaleString()}</span>
          </div>
        </div>
        <div className="gateway-card">
          <div className="gateway-card-icon gateway-card-icon--purple">
            <Users size={20} />
          </div>
          <div className="gateway-card-info">
            <span className="gateway-card-label">平均响应</span>
            <span className="gateway-card-value">{stats.avgResponseTime}ms</span>
          </div>
        </div>
      </div>

      <div className="gateway-section">
        <h3 className="gateway-section-title">端点信息</h3>
        <div className="gateway-endpoint-list">
          <div className="gateway-endpoint-item">
            <span className="gateway-endpoint-method">GET</span>
            <code className="gateway-endpoint-path">/mcp/sse</code>
            <span className="gateway-endpoint-desc">SSE 连接端点</span>
          </div>
          <div className="gateway-endpoint-item">
            <span className="gateway-endpoint-method">POST</span>
            <code className="gateway-endpoint-path">/mcp/messages</code>
            <span className="gateway-endpoint-desc">JSON-RPC 消息端点</span>
          </div>
        </div>
      </div>

      <div className="gateway-section">
        <h3 className="gateway-section-title">最近请求</h3>
        <div className="gateway-empty">
          <p>最近请求时间: {stats.lastRequest}</p>
        </div>
      </div>
    </div>
  );
}