import { useState, useEffect, useMemo, useRef } from 'react';
import Editor from '@monaco-editor/react';
import type { languages, IDisposable, editor } from 'monaco-editor';
import { updateQuery, runQuery } from '@/api';
import { listDatasources, getDatasourceStructure } from '@/api/datasource';
import { toast } from '@/stores/toastStore';
import type { Query, RunQueryResponse } from '@/types/query';
import type { Datasource, DatasourceStructure } from '@/types/datasource';
import './QueryEditor.css';

interface QueryEditorProps {
  query: Query;
  applicationId: number;
  onQueryUpdate: (query: Query) => void;
}

function validateDynamicTags(body: string): editor.IMarkerData[] {
  const markers: editor.IMarkerData[] = [];
  const stack: { tag: string; line: number; col: number }[] = [];
  const lines = body.split('\n');

  const tagRegex = /<\/?(if|foreach|where|set)(\s[^>]*)?>|<\/?(if|foreach|where|set)>/gi;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(body)) !== null) {
    const fullTag = match[0];
    const tagName = match[1] || match[3];
    const isClosing = fullTag.startsWith('</');

    const pos = match.index;
    let line = 1;
    let col = 1;
    let charCount = 0;
    for (let i = 0; i < lines.length; i++) {
      if (charCount + lines[i].length + 1 > pos) {
        line = i + 1;
        col = pos - charCount + 1;
        break;
      }
      charCount += lines[i].length + 1;
    }

    if (isClosing) {
      if (stack.length === 0) {
        markers.push({
          severity: 8,
          message: `多余的闭合标签 </${tagName}>，没有对应的开始标签`,
          startLineNumber: line,
          startColumn: col,
          endLineNumber: line,
          endColumn: col + fullTag.length,
        });
      } else {
        const top = stack[stack.length - 1];
        if (top.tag === tagName.toLowerCase()) {
          stack.pop();
        } else {
          markers.push({
            severity: 8,
            message: `标签不匹配：期望 </${top.tag}> 但遇到 </${tagName}>`,
            startLineNumber: line,
            startColumn: col,
            endLineNumber: line,
            endColumn: col + fullTag.length,
          });
        }
      }
    } else {
      if (tagName.toLowerCase() === 'if' && !fullTag.includes('test=')) {
        markers.push({
          severity: 8,
          message: '<if> 标签缺少 test 属性，如 <if test="paramName != null">',
          startLineNumber: line,
          startColumn: col,
          endLineNumber: line,
          endColumn: col + fullTag.length,
        });
      }
      if (tagName.toLowerCase() === 'foreach') {
        if (!fullTag.includes('collection=')) {
          markers.push({
            severity: 8,
            message: '<foreach> 标签缺少 collection 属性',
            startLineNumber: line,
            startColumn: col,
            endLineNumber: line,
            endColumn: col + fullTag.length,
          });
        }
      }
      stack.push({ tag: tagName.toLowerCase(), line, col });
    }
  }

  for (const item of stack) {
    markers.push({
      severity: 8,
      message: `未闭合的标签 <${item.tag}>，需要对应的 </${item.tag}>`,
      startLineNumber: item.line,
      startColumn: item.col,
      endLineNumber: item.line,
      endColumn: item.col + item.tag.length + 2,
    });
  }

  return markers;
}

export function QueryEditor({ query, applicationId, onQueryUpdate }: QueryEditorProps) {
  const [result, setResult] = useState<RunQueryResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [paramsText, setParamsText] = useState('');
  const [showParams, setShowParams] = useState(false);
  const structureRef = useRef<DatasourceStructure | null>(null);
  const providerRef = useRef<IDisposable | null>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);

  useEffect(() => {
    if (applicationId) {
      listDatasources(applicationId).then((res) => setDatasources(res.data));
    }
  }, [applicationId]);

  useEffect(() => {
    if (query.datasourceId) {
      getDatasourceStructure(query.datasourceId)
        .then((res) => { structureRef.current = res.data; })
        .catch(() => { structureRef.current = null; });
    }
  }, [query.datasourceId]);

  const selectedDs = useMemo(() => {
    return datasources.find((ds) => ds.id === query.datasourceId) || null;
  }, [datasources, query.datasourceId]);

  const handleBeforeMount = (monaco: typeof import('monaco-editor')) => {
    const sqlKeywords = [
      'SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER',
      'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'OUTER JOIN', 'ON',
      'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'AS',
      'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'BETWEEN', 'LIKE', 'IS NULL', 'IS NOT NULL',
      'COUNT', 'SUM', 'AVG', 'MAX', 'MIN', 'DISTINCT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
      'SET', 'VALUES', 'INTO', 'DEFAULT', 'PRIMARY KEY', 'FOREIGN KEY', 'REFERENCES',
      'ASC', 'DESC', 'NULLS FIRST', 'NULLS LAST',
    ];

    providerRef.current = monaco.languages.registerCompletionItemProvider('sql', {
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range: languages.CompletionItem['range'] = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        const suggestions: languages.CompletionItem[] = [];

        sqlKeywords.forEach((kw) => {
          suggestions.push({
            label: kw,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: kw,
            range,
          });
        });

        const structure = structureRef.current;
        if (!structure) return { suggestions };

        const textBefore = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });
        const fromMatch = textBefore.match(/from\s+([a-zA-Z_]*)$/i);
        const joinMatch = textBefore.match(/join\s+([a-zA-Z_]*)$/i);
        const columnMatch = textBefore.match(/\.([a-zA-Z_]*)$/);
        const whereMatch = textBefore.match(/where\s+|and\s+|or\s+|,\s*$/i);

        if (columnMatch) {
          const tablePrefix = textBefore.match(/([a-zA-Z_]+)\.([a-zA-Z_]*)$/);
          if (tablePrefix) {
            const tableName = tablePrefix[1].toLowerCase();
            const table = structure.tables.find(
              (t) => t.name.toLowerCase() === tableName,
            );
            if (table) {
              table.columns.forEach((col) => {
                suggestions.push({
                  label: col.name,
                  kind: monaco.languages.CompletionItemKind.Field,
                  detail: col.type,
                  insertText: col.name,
                  range,
                });
              });
            }
          }
          return { suggestions };
        }

        const isFromOrJoin = fromMatch || joinMatch;
        if (isFromOrJoin || !textBefore.includes('.')) {
          structure.tables.forEach((table) => {
            suggestions.push({
              label: table.name,
              kind: monaco.languages.CompletionItemKind.Class,
              detail: `${table.columns.length} columns`,
              insertText: table.name,
              range,
            });
          });
        }

        if (isFromOrJoin) {
          const tableAlias = isFromOrJoin[1] || '';
          if (tableAlias) {
            const matchedTable = structure.tables.find(
              (t) => t.name.toLowerCase() === tableAlias.toLowerCase(),
            );
            if (matchedTable) {
              matchedTable.columns.forEach((col) => {
                suggestions.push({
                  label: col.name,
                  kind: monaco.languages.CompletionItemKind.Field,
                  detail: col.type,
                  insertText: col.name,
                  range,
                });
              });
            }
          }
        }

        if (whereMatch) {
          structure.tables.forEach((table) => {
            table.columns.forEach((col) => {
              suggestions.push({
                label: `${table.name}.${col.name}`,
                kind: monaco.languages.CompletionItemKind.Field,
                detail: `${col.type} · ${table.name}`,
                insertText: `${table.name}.${col.name}`,
                range,
              });
            });
          });
        }

        return { suggestions };
      },
    });
  };

  const handleEditorDidMount = (editor: editor.IStandaloneCodeEditor, monaco: typeof import('monaco-editor')) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    const model = editor.getModel();
    if (model) {
      const markers = validateDynamicTags(model.getValue());
      monaco.editor.setModelMarkers(model, 'dynamic-tags', markers);
    }
  };

  const handleRun = async () => {
    setRunning(true);
    setResult(null);
    try {
      let params: Record<string, unknown> | undefined;
      if (paramsText.trim()) {
        try {
          params = JSON.parse(paramsText);
        } catch {
          toast.error('测试参数 JSON 格式错误');
          setRunning(false);
          return;
        }
      }
      const res = await runQuery(query.id, params ? { params } : undefined);
      setResult(res.data);
    } catch {
      toast.error('查询执行失败');
    } finally {
      setRunning(false);
    }
  };

  const handleSave = async () => {
    try {
      await updateQuery(query.id, { body: query.body });
      toast.success('保存成功');
    } catch {
      toast.error('保存失败');
    }
  };

  const handleBodyChange = (value: string | undefined) => {
    const body = value || '';
    onQueryUpdate({ ...query, body });
    updateQuery(query.id, { body });
    if (monacoRef.current && editorRef.current) {
      const model = editorRef.current.getModel();
      if (model) {
        const markers = validateDynamicTags(body);
        monacoRef.current.editor.setModelMarkers(model, 'dynamic-tags', markers);
      }
    }
  };

  const dsTypeLabel = (type: string) => {
    const t = type?.toLowerCase();
    switch (t) {
      case 'mysql': return { label: 'MySQL' };
      case 'postgresql': return { label: 'PostgreSQL' };
      case 'rest_api': return { label: 'REST API' };
      default: return { label: type };
    }
  };

  const isRestApi = selectedDs?.type?.toLowerCase() === 'rest_api';
  const isSql = selectedDs?.type?.toLowerCase() === 'mysql' || selectedDs?.type?.toLowerCase() === 'postgresql';

  const paramsPlaceholder = isSql
    ? '{ "name": "张三", "age": 25 }'
    : isRestApi
      ? '{ "queryParams": { "page": 1 }, "body": { "name": "test" } }'
      : '{ "name": "张三", "age": 25 }';

  const paramsHint = isSql
    ? 'JSON 格式，运行时会替换 {{ this.params.xxx }} 并用于动态标签条件判断'
    : isRestApi
      ? 'JSON 格式。queryParams → URL 参数，headers → 请求头，body → 请求体，其他字段替换端点 {{ this.params.xxx }}'
      : 'JSON 格式，运行时会替换 {{ this.params.xxx }} 并用于动态标签条件判断';

  const dsInfo = dsTypeLabel(selectedDs?.type || '');

  return (
    <div className="qe-container">
      <div className="qe-header">
        <div className="qe-header-left">
          <span className="qe-title">{query.name}</span>
          {selectedDs && (
            <span className="qe-ds-tag">{dsInfo.label}</span>
          )}
        </div>
        <div className="qe-header-actions">
          <button
            className={`qe-btn qe-params-btn ${showParams ? 'active' : ''}`}
            onClick={() => setShowParams(!showParams)}
          >
            {showParams ? '隐藏参数' : '测试参数'}
          </button>
          <button className="qe-btn qe-save-btn" onClick={handleSave}>保存</button>
          <button className="qe-btn qe-run-btn" onClick={handleRun} disabled={running}>
            {running ? '执行中...' : '运行'}
          </button>
        </div>
      </div>

      {showParams && (
        <div className="qe-params">
          <textarea
            className="qe-params-input"
            value={paramsText}
            onChange={(e) => setParamsText(e.target.value)}
            placeholder={paramsPlaceholder}
            rows={3}
          />
          <span className="qe-params-hint">{paramsHint}</span>
        </div>
      )}

      <div className="qe-editor">
        <Editor
          height="100%"
          defaultLanguage={selectedDs?.type === 'REST_API' ? 'json' : 'sql'}
          value={query.body || ''}
          onChange={handleBodyChange}
          beforeMount={handleBeforeMount}
          onMount={handleEditorDidMount}
          theme="vs"
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            suggest: { showKeywords: true, showSnippets: true },
          }}
        />
      </div>

      {result && (
        <div className="qe-result">
          <div className="qe-result-header">
            <span className="qe-result-meta">
              {result.totalCount} 条记录 · {result.executionTime}ms
            </span>
          </div>
          <div className="qe-result-table-wrap">
            <table className="qe-result-table">
              <thead>
                <tr>
                  {result.columns.map((col) => (
                    <th key={col}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.slice(0, 100).map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j}>{String(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}