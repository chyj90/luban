import { useState, useEffect, useMemo } from 'react';
import Select from '@/components/Select';
import { listDatasources, createDatasource, updateDatasource, testDatasource, getDatasourceStructure, deleteDatasource } from '@/api/datasource';
import { listDrivers, installDriver } from '@/api/driver';
import { listApplicationDatasources } from '@/api/tool';
import { useToastStore } from '@/stores/toastStore';
import { confirm } from '@/stores/confirmStore';
import type { Datasource, DatasourceStructure, DriverInfo, InstallProgress, ExtraField } from '@/types/datasource';
import './DatasourcePanel.css';

interface DatasourcePanelProps {
  applicationId: number;
}

interface FormState {
  name: string;
  type: string;
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  baseUrl: string;
  headers: { key: string; value: string }[];
  authType: string;
  authUsername: string;
  authPassword: string;
  apiKey: string;
  apiValue: string;
  apiAddTo: string;
  bearerToken: string;
}

const EMPTY_FORM: FormState = {
  name: '', type: '', host: '', port: '', database: '', username: '', password: '',
  baseUrl: '', headers: [], authType: 'none',
  authUsername: '', authPassword: '', apiKey: '', apiValue: '', apiAddTo: 'header', bearerToken: '',
};

const PASSWORD_PLACEHOLDER = '••••••••';

interface InstallState {
  driverName: string;
  displayName: string;
  progress: InstallProgress[];
  status: 'confirming' | 'installing' | 'done' | 'error';
  errorMsg: string;
}

function isJdbcType(type: string) {
  return type !== 'rest_api' && type !== 'REST_API';
}

export function DatasourcePanel({ applicationId }: DatasourcePanelProps) {
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [keyDatasources, setKeyDatasources] = useState<Array<{ id: number; name: string; type?: string; config?: Record<string, unknown> }>>([]);
  const [drivers, setDrivers] = useState<DriverInfo[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [structure, setStructure] = useState<DatasourceStructure | null>(null);
  const [selectedDsId, setSelectedDsId] = useState<number | null>(null);
  const [testing, setTesting] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [install, setInstall] = useState<InstallState | null>(null);
  const toast = useToastStore((s) => s.show);

  useEffect(() => {
    listDatasources('APPLICATION', applicationId).then((res) => setDatasources(res.data));
    listApplicationDatasources(applicationId).then((res) => setKeyDatasources((res.data as Array<{ id: number; name: string; type?: string }>) || [])).catch(() => setKeyDatasources([]));
    listDrivers().then((res) => setDrivers(res.data)).catch(() => {});
  }, [applicationId]);

  const buildConfig = () => {
    if (isJdbcType(form.type)) {
      const config: Record<string, unknown> = {
        host: form.host, port: Number(form.port) || 3306,
        database: form.database, username: form.username, password: form.password,
      };
      const driver = getDriverInfo(form.type);
      if (driver?.extraFields) {
        const fieldValues = form as Record<string, unknown>;
        for (const ef of driver.extraFields) {
          const val = fieldValues[ef.name];
          if (val !== undefined && val !== '') {
            config[ef.name] = val;
          }
        }
      }
      return config;
    }
    const config: Record<string, unknown> = { baseUrl: form.baseUrl };
    if (form.headers.length > 0) {
      config.headers = form.headers;
    }
    if (form.authType !== 'none') {
      config.authType = form.authType;
      if (form.authType === 'basic') {
        config.authUsername = form.authUsername;
        config.authPassword = form.authPassword;
      }
      if (form.authType === 'apiKey') {
        config.apiKey = form.apiKey;
        config.apiValue = form.apiValue;
        config.apiAddTo = form.apiAddTo;
      }
      if (form.authType === 'bearer') {
        config.bearerToken = form.bearerToken;
      }
    }
    return config;
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) { toast('请输入数据源名称', 'error'); return; }
    if (!form.type) { toast('请选择数据源类型', 'error'); return; }

    const driver = drivers.find((d) => d.name.toLowerCase() === form.type.toLowerCase());
    if (driver && !driver.installed && isJdbcType(form.type)) {
      toast('请先安装驱动', 'error');
      return;
    }

    const config = buildConfig();
    const payload = {
      ownerId: applicationId, slug: 'APPLICATION' as const,
      name: form.name, type: form.type, config,
    };

    if (editingId) {
      const res = await updateDatasource(editingId, payload);
      setDatasources(datasources.map((d) => (d.id === editingId ? res.data : d)));
    } else {
      const res = await createDatasource(payload);
      setDatasources([...datasources, res.data]);
    }
    setShowForm(false);
    setForm(EMPTY_FORM);
    setEditingId(null);
    toast(editingId ? '数据源已更新' : '数据源已创建', 'success');
  };

  const handleEdit = (ds: Datasource) => {
    const config = ds.config || {};
    const authType = (config.authType as string) || 'none';
    setForm({
      name: ds.name,
      type: ds.type,
      host: String(config.host || ''),
      port: String(config.port || ''),
      database: String(config.database || ''),
      username: String(config.username || ''),
      password: PASSWORD_PLACEHOLDER,
      baseUrl: String(config.baseUrl || ''),
      headers: (config.headers as { key: string; value: string }[]) || [],
      authType,
      authUsername: String(config.authUsername || ''),
      authPassword: '',
      apiKey: String(config.apiKey || ''),
      apiValue: '',
      apiAddTo: (config.apiAddTo as 'header' | 'query') || 'header',
      bearerToken: '',
    });
    setEditingId(ds.id);
    setShowForm(true);
  };

  const handleTypeSelect = (typeName: string) => {
    const driver = drivers.find((d) => d.name.toLowerCase() === typeName.toLowerCase());
    const port = driver ? String(driver.defaultPort) : '';
    setForm({ ...form, type: typeName, port });
  };

  const handleInstallDriver = async (driverName: string) => {
    const driver = drivers.find((d) => d.name === driverName);
    if (!driver) return;

    setInstall({ driverName, displayName: driver.displayName, progress: [], status: 'confirming', errorMsg: '' });
  };

  const confirmInstall = () => {
    if (!install) return;
    const driver = drivers.find((d) => d.name === install.driverName);
    if (!driver) return;

    setInstall({ ...install, status: 'installing' });

    installDriver(
      install.driverName,
      (progress) => {
        setInstall((prev) => prev ? { ...prev, progress: [...prev.progress, progress] } : null);
      },
      () => {
        setInstall((prev) => prev ? {
          ...prev,
          status: 'done',
          progress: [...prev.progress, { phase: 'COMPLETE', fileName: '安装完成', current: 1, total: 1, percent: 100 }],
        } : null);
        setDrivers(drivers.map((d) => (d.name === install.driverName ? { ...d, installed: true } : d)));
        setTimeout(() => setInstall(null), 2000);
      },
      (err) => {
        setInstall((prev) => prev ? { ...prev, status: 'error', errorMsg: err } : null);
      },
    );
  };

  const handleCancel = () => {
    setShowForm(false);
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const handleTest = async (id: number) => {
    setTesting(id);
    const res = await testDatasource(id);
    toast(res.data.message, res.data.success ? 'success' : 'error');
    setTesting(null);
  };

  const handleViewStructure = async (id: number) => {
    if (selectedDsId === id) { setSelectedDsId(null); setStructure(null); return; }
    setSelectedDsId(id);
    const res = await getDatasourceStructure(id);
    setStructure(res.data);
  };

  const handleDelete = async (id: number) => {
    const ok = await confirm({ title: '确认删除', message: '确定删除此数据源？', confirmText: '删除', variant: 'danger' });
    if (!ok) return;
    await deleteDatasource(id);
    setDatasources(datasources.filter((d) => d.id !== id));
    if (selectedDsId === id) { setSelectedDsId(null); setStructure(null); }
    toast('数据源已删除', 'success');
  };

  const getDriverInfo = (type: string) => {
    return drivers.find((d) => d.name.toLowerCase() === type.toLowerCase());
  };

  const getDsDisplay = (type: string) => {
    const driver = getDriverInfo(type);
    if (driver) return {
      label: driver.displayName,
      color: driverColors[driver.category] || '#8c9cab',
      badgeClass: badgeClassMap[driver.category] || '',
    };
    if (type.toLowerCase() === 'rest_api') return {
      label: 'REST API', color: '#fa8c16', badgeClass: 'ds-badge-api',
    };
    return { label: type, color: '#8c9cab', badgeClass: '' };
  };

  const driverColors: Record<string, string> = {
    OLAP: '#1677ff', DATALAKE: '#52c41a', QUERY_ENGINE: '#722ed1',
    RELATIONAL: '#00758f', CLOUD: '#13c2c2', OTHER: '#8c9cab',
  };

  const badgeClassMap: Record<string, string> = {
    RELATIONAL: 'ds-badge-relational',
    OLAP: 'ds-badge-olap',
    QUERY_ENGINE: 'ds-badge-query',
    DATALAKE: 'ds-badge-datalake',
    CLOUD: 'ds-badge-cloud',
    API: 'ds-badge-api',
  };

  const dataSourceTypeOptions = useMemo(() => {
    const options: Array<{ value: string; label: string }> = [
      { value: 'MySQL', label: 'MySQL' },
      { value: 'PostgreSQL', label: 'PostgreSQL' },
    ];
    if (drivers.length > 0) {
      for (const d of drivers.filter((d) => d.enabled)) {
        options.push({
          value: d.name,
          label: `${d.displayName}${d.installed ? '' : ' (需安装)'}`,
        });
      }
    }
    return options;
  }, [drivers]);

  const selectedDriver = getDriverInfo(form.type);
  const needsInstall = selectedDriver && !selectedDriver.installed && isJdbcType(form.type);

  return (
    <div className="ds-panel">
      <div className="ds-panel-header">
        <span className="ds-panel-title">数据源</span>
        <button className="ds-add-btn" onClick={() => { setShowForm(!showForm); setEditingId(null); setForm(EMPTY_FORM); }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          新建
        </button>
      </div>

      {showForm && (
        <div className="ds-form">
          <div className="ds-form-field">
            <label className="ds-label">数据源类型</label>
            <Select
              value={form.type}
              options={dataSourceTypeOptions}
              onChange={handleTypeSelect}
              placeholder="请选择类型"
            />
          </div>

          {needsInstall && (
            <div className="ds-install-banner">
              <span className="ds-install-icon">⚠</span>
              <span>{selectedDriver!.displayName} 驱动未安装，需先安装才能使用</span>
              <button
                className="ds-btn ds-btn-primary"
                onClick={() => handleInstallDriver(selectedDriver!.name)}
                disabled={install?.status === 'installing'}
              >
                {install?.status === 'installing' && install.driverName === selectedDriver!.name
                  ? '安装中...'
                  : '安装驱动'}
              </button>
            </div>
          )}

          {install && install.status !== 'confirming' && (
            <div className="ds-install-progress">
              <div className="ds-install-title">
                {install.status === 'installing' ? '正在安装 ' : ''}{install.displayName}
                {install.status === 'done' && ' ✅'}
                {install.status === 'error' && ' ❌'}
              </div>
              {install.progress.length > 0 && (
                <div className="ds-install-progress-bar">
                  <div
                    className="ds-install-progress-fill"
                    style={{ width: `${install.progress[install.progress.length - 1]?.percent || 0}%` }}
                  />
                </div>
              )}
              <div className="ds-install-log">
                {install.progress.map((p, i) => (
                  <div key={i} className="ds-install-line">
                    {p.phase === 'REGISTERING' && '🔧 '}
                    {p.fileName}
                    {p.total > 0 && ` (${p.current}/${p.total})`}
                  </div>
                ))}
              </div>
              {install.status === 'error' && (
                <div className="ds-install-error">{install.errorMsg}</div>
              )}
              {(install.status === 'done' || install.status === 'error') && (
                <button className="ds-btn ds-btn-cancel" onClick={() => setInstall(null)}>关闭</button>
              )}
            </div>
          )}

          {install && install.status === 'confirming' && (() => {
            const driver = drivers.find((d) => d.name === install.driverName);
            if (!driver) return null;
            return (
              <div className="ds-install-overlay">
                <div className="ds-install-dialog">
                  <div className="ds-install-dialog-title">安装驱动</div>
                  <div className="ds-install-dialog-body">
                    <div className="ds-install-dialog-row">
                      <span className="ds-install-dialog-label">驱动</span>
                      <span>{driver.displayName}</span>
                    </div>
                    <div className="ds-install-dialog-row">
                      <span className="ds-install-dialog-label">Maven 坐标</span>
                      <span className="ds-install-dialog-mono">{driver.groupId}:{driver.artifactId}:{driver.version}</span>
                    </div>
                    <div className="ds-install-dialog-row">
                      <span className="ds-install-dialog-label">驱动类名</span>
                      <span className="ds-install-dialog-mono">{driver.driverClass}</span>
                    </div>
                    <div className="ds-install-dialog-row">
                      <span className="ds-install-dialog-label">JDBC URL 模板</span>
                      <span className="ds-install-dialog-mono">{driver.jdbcUrlTemplate}</span>
                    </div>
                    <div className="ds-install-dialog-row">
                      <span className="ds-install-dialog-label">默认端口</span>
                      <span>{driver.defaultPort}</span>
                    </div>
                    <div className="ds-install-dialog-note">
                      将从 Maven 仓库自动下载驱动 JAR 及所有依赖
                    </div>
                  </div>
                  <div className="ds-install-dialog-actions">
                    <button className="ds-btn ds-btn-primary" onClick={confirmInstall}>确认安装</button>
                    <button className="ds-btn ds-btn-cancel" onClick={() => setInstall(null)}>取消</button>
                  </div>
                </div>
              </div>
            );
          })()}

          <input
            className="ds-input"
            placeholder="数据源名称"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            autoFocus
          />

          {isJdbcType(form.type) && (
            <div className="ds-form-grid">
              {!(selectedDriver?.hideStandardFields) && (
                <>
                  <input className="ds-input" placeholder="主机" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
                  <input className="ds-input" placeholder="端口" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
                  <input className="ds-input" placeholder="数据库" value={form.database} onChange={(e) => setForm({ ...form, database: e.target.value })} />
                </>
              )}
              {selectedDriver?.extraFields?.map((ef: ExtraField) => {
                const val = (form as Record<string, unknown>)[ef.name] as string || '';
                if (ef.type === 'select') {
                  return (
                    <Select
                      key={ef.name}
                      value={val}
                      options={[
                        { value: 'http', label: 'HTTP' },
                        { value: 'binary', label: 'Binary' },
                      ]}
                      onChange={(value) => setForm({ ...form, [ef.name]: value })}
                      placeholder={ef.label}
                    />
                  );
                }
                return (
                  <input
                    key={ef.name}
                    className="ds-input"
                    placeholder={ef.placeholder || ef.label}
                    type={ef.type === 'password' ? 'password' : 'text'}
                    value={val}
                    onChange={(e) => setForm({ ...form, [ef.name]: e.target.value })}
                  />
                );
              })}
              {selectedDriver?.hideStandardFields && (
                <input className="ds-input" placeholder="主机" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
              )}
              <input className="ds-input" placeholder="用户名" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
              <input
                className="ds-input"
                type="password"
                placeholder={editingId ? '不修改请留空' : '密码'}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
          )}

          {form.type === 'rest_api' && (
            <div className="ds-section ds-input-full">
              <input className="ds-input" placeholder="Base URL（如 https://api.example.com）" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />

              <div className="ds-section-header">
                <span>Headers</span>
                <button className="ds-kv-add" onClick={() => setForm({ ...form, headers: [...form.headers, { key: '', value: '' }] })}>+ 添加</button>
              </div>
              {form.headers.map((h, i) => (
                <div key={i} className="ds-kv-row">
                  <input className="ds-input" placeholder="Key" value={h.key} onChange={(e) => {
                    const nh = [...form.headers];
                    nh[i] = { ...nh[i], key: e.target.value };
                    setForm({ ...form, headers: nh });
                  }} />
                  <input className="ds-input" placeholder="Value" value={h.value} onChange={(e) => {
                    const nh = [...form.headers];
                    nh[i] = { ...nh[i], value: e.target.value };
                    setForm({ ...form, headers: nh });
                  }} />
                  <button className="ds-kv-remove" onClick={() => setForm({ ...form, headers: form.headers.filter((_, j) => j !== i) })}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              ))}

              <div className="ds-section ds-input-full">
                <div className="ds-section-header">
                  <span>认证</span>
                </div>
                <Select
                  value={form.authType}
                  options={[
                    { value: 'none', label: 'None' },
                    { value: 'basic', label: 'Basic Auth' },
                    { value: 'apiKey', label: 'API Key' },
                    { value: 'bearer', label: 'Bearer Token' },
                  ]}
                  onChange={(value) => setForm({ ...form, authType: value })}
                  placeholder="选择认证方式"
                />

                {form.authType === 'basic' && (
                  <>
                    <input className="ds-input" placeholder="用户名" value={form.authUsername} onChange={(e) => setForm({ ...form, authUsername: e.target.value })} />
                    <input className="ds-input" placeholder="密码" type="password" value={form.authPassword} onChange={(e) => setForm({ ...form, authPassword: e.target.value })} />
                  </>
                )}

                {form.authType === 'apiKey' && (
                  <>
                    <input className="ds-input" placeholder="Key 名称" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
                    <input className="ds-input" placeholder="Value" type="password" value={form.apiValue} onChange={(e) => setForm({ ...form, apiValue: e.target.value })} />
                    <Select
                      value={form.apiAddTo}
                      options={[
                        { value: 'header', label: '添加到 Header' },
                        { value: 'query', label: '添加到 Query 参数' },
                      ]}
                      onChange={(value) => setForm({ ...form, apiAddTo: value as 'header' | 'query' })}
                      placeholder="添加位置"
                    />
                  </>
                )}

                {form.authType === 'bearer' && (
                  <input className="ds-input" placeholder="Bearer Token" type="password" value={form.bearerToken} onChange={(e) => setForm({ ...form, bearerToken: e.target.value })} />
                )}
              </div>
            </div>
          )}

          <div className="ds-form-actions">
            <button className="ds-btn ds-btn-primary" onClick={handleSubmit} disabled={needsInstall}>
              {editingId ? '保存' : '创建'}
            </button>
            <button className="ds-btn ds-btn-cancel" onClick={handleCancel}>取消</button>
          </div>
        </div>
      )}

      <div className="ds-list">
        {keyDatasources.length > 0 && (
          <div className="ds-section">
            <div className="ds-section-header">
              <span className="ds-section-title">KEY 授权数据源</span>
              <span className="ds-section-count">{keyDatasources.length}</span>
            </div>
            {keyDatasources.map((kd) => {
              const info = getDsDisplay(kd.type || '');
              return (
                <div key={kd.id} className="ds-card ds-card-key">
                  <div className="ds-card-main">
                    <div className="ds-card-icon" style={{ background: info.color + '14', color: info.color }}>
                      {info.label.charAt(0)}
                    </div>
                    <div className="ds-card-info">
                      <span className="ds-card-name">{kd.name}</span>
                      <span className={`ds-card-type ${info.badgeClass || ''}`}>{info.label} · 来自 KEY</span>
                    </div>
                    <span className="ds-card-badge ds-badge-key">KEY</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {datasources.length === 0 && keyDatasources.length === 0 && !showForm && (
          <div className="ds-empty">暂无数据源，点击"新建"添加</div>
        )}
        {datasources.map((ds) => {
          const info = getDsDisplay(ds.type);
          const isConnected = ds.status === 'connected';
          return (
            <div key={ds.id} className="ds-card">
              <div className="ds-card-main">
                <div className="ds-card-icon" style={{ background: info.color + '14', color: info.color }}>
                  {info.label.charAt(0)}
                </div>
                <div className="ds-card-info">
                  <span className="ds-card-name">{ds.name}</span>
                  <span className={`ds-card-type ${info.badgeClass || ''}`}>{info.label}</span>
                </div>
                <span className={`ds-card-status ${isConnected ? 'connected' : ''}`}>
                  {isConnected ? '●' : '○'}
                </span>
              </div>
              <div className="ds-card-actions">
                <button className="ds-action-btn" onClick={() => handleEdit(ds)}>编辑</button>
                <button className="ds-action-btn" onClick={() => handleTest(ds.id)} disabled={testing === ds.id}>
                  {testing === ds.id ? '测试中...' : '测试'}
                </button>
                {isJdbcType(ds.type) && (
                  <button className="ds-action-btn" onClick={() => handleViewStructure(ds.id)}>
                    {selectedDsId === ds.id ? '收起' : '结构'}
                  </button>
                )}
                <button className="ds-action-btn ds-action-danger" onClick={() => handleDelete(ds.id)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6" />
                    <path d="M14 11v6" />
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                  删除
                </button>
              </div>

              {selectedDsId === ds.id && structure && (
                <div className="ds-structure">
                  <div className="ds-structure-title">数据库表结构</div>
                  {structure.tables.map((table) => (
                    <div key={table.name} className="ds-table">
                      <div className="ds-table-name">{table.name}</div>
                      {table.columns.map((col) => (
                        <div key={col.name} className="ds-column">
                          <span className="ds-col-name">{col.name}</span>
                          <span className="ds-col-type">{col.type}</span>
                          {col.primaryKey && <span className="ds-col-pk">PK</span>}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}