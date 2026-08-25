import { Globe, Code, FileText, Copy, Check, ArrowUp, ArrowDown } from 'lucide-react';
import { useState } from 'react';
import './ApiDetail.css';

interface KeyToolItem {
  id: number;
  toolId: number;
  apiKeyId: number;
  status: string;
  toolName: string;
  displayName: string;
  description: string;
  toolType: string;
  inputSchema: string;
  outputSchema: string;
  config: string;
}

interface HttpConfig {
  method?: string;
  url?: string;
  timeout?: number;
  retry?: number;
  headers?: Record<string, string>;
}

interface KeyValuePair {
  key: string;
  value: string;
  enabled: boolean;
}

interface AppApiItem {
  id: number;
  name: string;
  method: string;
  url: string;
  description: string;
  headers: KeyValuePair[];
  queryParams: KeyValuePair[];
  body: string;
  contentType: string;
}

export type SelectedApi =
  | { type: 'key'; data: KeyToolItem }
  | { type: 'app'; data: AppApiItem };

interface ApiDetailProps {
  api: SelectedApi | null;
}

const METHOD_COLORS: Record<string, string> = {
  GET: '#52c41a', POST: '#1677ff', PUT: '#fa8c16', DELETE: '#ff4d4f', PATCH: '#722ed1',
};

function formatJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function buildCurl(app: AppApiItem): string {
  const lines: string[] = ['curl'];
  if (app.method !== 'GET') {
    lines.push(`-X ${app.method}`);
  }
  const enabledHeaders = (app.headers || []).filter((h) => h.enabled !== false && h.key);
  for (const h of enabledHeaders) {
    lines.push(`-H "${h.key}: ${h.value}"`);
  }
  if (app.body && app.body.trim()) {
    lines.push(`-H "Content-Type: ${app.contentType || 'application/json'}"`);
    lines.push(`-d '${app.body}'`);
  }
  let url = app.url;
  const enabledParams = (app.queryParams || []).filter((p) => p.enabled !== false && p.key);
  if (enabledParams.length > 0) {
    const qs = enabledParams.map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join('&');
    url += (url.includes('?') ? '&' : '?') + qs;
  }
  lines.push(`"${url}"`);
  return lines.join(' \\\n  ');
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button className="api-detail-copy" onClick={handleCopy} title="复制">
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

function CodeBlock({ label, text, grow }: { label: string; text: string; grow?: boolean }) {
  return (
    <div className={`api-detail-section ${grow ? 'api-detail-section--grow' : ''}`}>
      <div className="api-detail-section-title">
        <Code size={14} />
        {label}
      </div>
      <div className="api-detail-code-wrap">
        <CopyButton text={text} />
        <pre className="api-detail-code">{text}</pre>
      </div>
    </div>
  );
}

function KvTable({ pairs }: { pairs: KeyValuePair[] }) {
  if (!pairs || pairs.length === 0) return null;
  return (
    <table className="api-detail-table">
      <thead>
        <tr>
          <th>Key</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        {pairs.map((p, i) => (
          <tr key={i} className={p.enabled === false ? 'api-detail-row-disabled' : ''}>
            <td className="api-detail-table-key">{p.key}</td>
            <td className="api-detail-table-val">{p.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ApiDetail({ api }: ApiDetailProps) {
  if (!api) {
    return (
      <div className="api-detail-empty">
        <div className="api-detail-empty-icon">
          <Globe size={32} />
        </div>
        <span className="api-detail-empty-title">选择 API 查看详情</span>
        <span className="api-detail-empty-hint">从左侧列表选择一个 API</span>
      </div>
    );
  }

  if (api.type === 'key') {
    const tool = api.data;
    const inputSchema = tool.inputSchema ? formatJson(tool.inputSchema) : '';
    const outputSchema = tool.outputSchema ? formatJson(tool.outputSchema) : '';

    let httpConfig: HttpConfig | null = null;
    try {
      httpConfig = JSON.parse(tool.config || '{}');
      if (!httpConfig?.url) httpConfig = null;
    } catch {
      httpConfig = null;
    }

    const httpMethod = httpConfig?.method || '';
    const httpUrl = httpConfig?.url || '';
    const httpHeaders = httpConfig?.headers ? Object.entries(httpConfig.headers).map(([k, v]) => ({ key: k, value: v, enabled: true })) : [];
    const httpTimeout = httpConfig?.timeout;
    const httpRetry = httpConfig?.retry;

    const methodColor = httpMethod ? (METHOD_COLORS[httpMethod] || '#666') : '#1677ff';

    return (
      <div className="api-detail">
        <div className="api-detail-header">
          <span className="api-detail-method" style={httpMethod ? { background: methodColor + '14', color: methodColor } : { background: '#e6f4ff', color: '#1677ff' }}>
            {httpMethod || tool.toolType}
          </span>
          <span className="api-detail-name">{tool.displayName || tool.toolName}</span>
          <span className="api-detail-status">
            <span className={`api-detail-dot ${tool.status === 'ENABLED' ? 'enabled' : ''}`} />
            {tool.status === 'ENABLED' ? '已启用' : tool.status}
          </span>
        </div>

        {httpUrl && (
          <div className="api-detail-section">
            <div className="api-detail-section-title">
              <Globe size={14} />
              请求地址
            </div>
            <div className="api-detail-code-wrap">
              <CopyButton text={httpUrl} />
              <code className="api-detail-url">{httpUrl}</code>
            </div>
          </div>
        )}

        {tool.description && (
          <div className="api-detail-section">
            <div className="api-detail-section-title">
              <FileText size={14} />
              描述
            </div>
            <p className="api-detail-desc">{tool.description}</p>
          </div>
        )}

        {httpHeaders.length > 0 && (
          <div className="api-detail-section">
            <div className="api-detail-section-title">
              <ArrowUp size={14} />
              Headers
            </div>
            <KvTable pairs={httpHeaders} />
          </div>
        )}

        {(httpTimeout !== undefined || httpRetry !== undefined) && (
          <div className="api-detail-section">
            <div className="api-detail-section-title">
              <Code size={14} />
              请求配置
            </div>
            <div className="api-detail-meta">
              {httpTimeout !== undefined && (
                <div className="api-detail-meta-item">
                  <span className="api-detail-meta-label">超时</span>
                  <span className="api-detail-meta-value">{httpTimeout}s</span>
                </div>
              )}
              {httpRetry !== undefined && (
                <div className="api-detail-meta-item">
                  <span className="api-detail-meta-label">重试</span>
                  <span className="api-detail-meta-value">{httpRetry} 次</span>
                </div>
              )}
            </div>
          </div>
        )}

        {inputSchema && <CodeBlock label="输入参数" text={inputSchema} grow />}
        {outputSchema && <CodeBlock label="输出格式" text={outputSchema} />}
      </div>
    );
  }

  const app = api.data;
  const curl = buildCurl(app);
  const methodColor = METHOD_COLORS[app.method] || '#666';
  const hasHeaders = app.headers && app.headers.length > 0;
  const hasParams = app.queryParams && app.queryParams.length > 0;
  const hasBody = app.body && app.body.trim().length > 0;

  return (
    <div className="api-detail">
      <div className="api-detail-header">
        <span className="api-detail-method" style={{ background: methodColor + '14', color: methodColor }}>
          {app.method}
        </span>
        <span className="api-detail-name">{app.name}</span>
      </div>

      <div className="api-detail-section">
        <div className="api-detail-section-title">
          <Globe size={14} />
          请求地址
        </div>
        <div className="api-detail-code-wrap">
          <CopyButton text={app.url} />
          <code className="api-detail-url">{app.url}</code>
        </div>
      </div>

      {app.description && (
        <div className="api-detail-section">
          <div className="api-detail-section-title">
            <FileText size={14} />
            描述
          </div>
          <p className="api-detail-desc">{app.description}</p>
        </div>
      )}

      {hasHeaders && (
        <div className="api-detail-section">
          <div className="api-detail-section-title">
            <ArrowUp size={14} />
            Headers
          </div>
          <KvTable pairs={app.headers} />
        </div>
      )}

      {hasParams && (
        <div className="api-detail-section">
          <div className="api-detail-section-title">
            <ArrowDown size={14} />
            Query 参数
          </div>
          <KvTable pairs={app.queryParams} />
        </div>
      )}

      {hasBody && (
        <div className="api-detail-section">
          <div className="api-detail-section-title">
            <Code size={14} />
            Body
            <span className="api-detail-content-type">{app.contentType || 'application/json'}</span>
          </div>
          <div className="api-detail-code-wrap">
            <CopyButton text={app.body} />
            <pre className="api-detail-code">{app.body}</pre>
          </div>
        </div>
      )}

      <div className="api-detail-section">
        <div className="api-detail-section-title">
          <Code size={14} />
          调用示例
        </div>
        <div className="api-detail-code-wrap">
          <CopyButton text={curl} />
          <pre className="api-detail-code">{curl}</pre>
        </div>
      </div>

      <div className="api-detail-section">
        <div className="api-detail-section-title">
          <Code size={14} />
          SDK 调用
        </div>
        <div className="api-detail-sdk-hint">
          在页面 JS 中使用 <code>__LUBAN__.callApi</code> 调用，参数会自动替换 URL/Header/Body 中的 <code>{'{{变量名}}'}</code> 占位符
        </div>
        <div className="api-detail-code-wrap">
          <CopyButton text={`__LUBAN__.callApi('${app.name}', {
  // 替换 {{变量名}} 占位符
}).then(res => console.log(res));`} />
          <pre className="api-detail-code">{`__LUBAN__.callApi('${app.name}', {
  // 替换 {{变量名}} 占位符
}).then(res => console.log(res));`}</pre>
        </div>
      </div>
    </div>
  );
}