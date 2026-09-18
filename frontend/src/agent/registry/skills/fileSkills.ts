/**
 * 文件（file:*）技能：读取用户上传的 Word/TXT/Excel 附件。
 * 全部只读、走 REST 分页接口，大文件不整读（提取文本分页、Excel 按行）。
 */
import { SkillCategory, type SkillFactory } from '../skillRegistry';
import {
  listAgentFiles,
  getAgentFileMeta,
  readAgentFileText,
  readAgentFileSheet,
  executeAgentFilePython,
} from '@/api/agentFile';
import { executeSql } from '@/api/query';

/** 标识符合法性：普通标识符 / 点分 / 反引号包裹，阻断注入与误用 */
function isSqlIdentifier(name: string): boolean {
  const s = name.trim();
  return /^[A-Za-z_][A-Za-z0-9_$]*(\.[A-Za-z_][A-Za-z0-9_$]*)?$/.test(s) || /^`[^`]+`$/.test(s);
}

/** MySQL 字面量转义：反斜杠与单引号都要翻倍，剔除 NUL */
function escapeSqlLiteral(s: string): string {
  return s.replace(/\u0000/g, '').replace(/\\/g, '\\\\').replace(/'/g, "''");
}

interface ColumnMapping {
  column: string;
  sheetCol: number;
  type?: 'string' | 'number' | 'date';
}

/** 按映射类型把单元格值渲染成 SQL 字面量；空串一律 NULL */
function renderSqlValue(raw: string | undefined, type?: ColumnMapping['type']): { sql?: string; error?: string } {
  const v = (raw ?? '').trim();
  if (v === '') return { sql: 'NULL' };
  if (type === 'number') {
    let n = Number(v);
    if (!Number.isFinite(n) && /^-?[\d,\s]+(\.\d+)?$/.test(v)) n = Number(v.replace(/,/g, ''));
    if (!Number.isFinite(n)) return { error: `非法数字 "${v}"` };
    return { sql: String(n) };
  }
  return { sql: `'${escapeSqlLiteral(v)}'` };
}

export const fileSkills: Record<string, SkillFactory> = {
  'file:list': (ctx) => ({
    id: 'file:list',
    category: SkillCategory.FILE,
    name: 'file_list',
    description: '列出当前应用中用户上传的全部附件文件（fileKey、名称、类型、规模、概要）。',
    parameters: { type: 'object', properties: {} },
    async execute() {
      try {
        const res = await listAgentFiles(ctx.applicationId);
        const files = res.data || [];
        if (files.length === 0) {
          return { success: true, message: '当前应用暂无上传的附件文件', data: { files: [] } };
        }
        return {
          success: true,
          message: `共 ${files.length} 个附件文件`,
          data: {
            files: files.map((f) => ({
              fileId: f.fileId,
              name: f.name,
              fileType: f.fileType,
              size: f.size,
              contentChars: f.contentChars,
              summary: f.summary,
            })),
          },
        };
      } catch (e) {
        return { success: false, message: `获取文件列表失败: ${(e as Error).message}` };
      }
    },
  }),

  'file:info': () => ({
    id: 'file:info',
    category: SkillCategory.FILE,
    name: 'file_info',
    description: '获取附件的元信息。Excel 返回各工作表名称、行数、列数、表头与预览行；Word/TXT 返回概要。',
    parameters: {
      type: 'object',
      properties: { fileId: { type: 'string', description: '文件 ID（来自用户消息附件或 file_list）' } },
      required: ['fileId'],
    },
    async execute(args) {
      try {
        const res = await getAgentFileMeta(args.fileId as string);
        return { success: true, message: `文件「${res.data.name}」：${res.data.summary || ''}`, data: res.data };
      } catch (e) {
        return { success: false, message: `获取文件信息失败: ${(e as Error).message}` };
      }
    },
  }),

  'file:read': () => ({
    id: 'file:read',
    category: SkillCategory.FILE,
    name: 'file_read',
    description: '分页读取附件（Word/TXT/CSV）的提取文本。返回内容与 nextOffset；若 nextOffset 非空，继续读取时把它作为下一次的 offset 传入。',
    parameters: {
      type: 'object',
      properties: {
        fileId: { type: 'string', description: '文件 ID' },
        offset: { type: 'number', description: '起始字符位置，默认 0' },
        limit: { type: 'number', description: '本次读取字符数，默认 4000' },
      },
      required: ['fileId'],
    },
    async execute(args) {
      try {
        const res = await readAgentFileText(
          args.fileId as string,
          typeof args.offset === 'number' ? args.offset : 0,
          typeof args.limit === 'number' ? args.limit : 4000,
        );
        const d = res.data;
        return {
          success: true,
          message: d.nextOffset == null
            ? `已读到文件末尾（共 ${d.totalChars} 字）`
            : `已读取 ${d.offset}-${d.offset + d.content.length} 字，共 ${d.totalChars} 字，可用 offset=${d.nextOffset} 继续读取`,
          data: d,
        };
      } catch (e) {
        return { success: false, message: `读取文件失败: ${(e as Error).message}` };
      }
    },
  }),

  'file:sheet': () => ({
    id: 'file:sheet',
    category: SkillCategory.FILE,
    name: 'file_sheet',
    description: '分页读取 Excel 某工作表的数据行（二维数组）。返回 rows/totalRows/nextStartRow；若 nextStartRow 非空，继续读取时把它作为下一次的 startRow 传入。',
    parameters: {
      type: 'object',
      properties: {
        fileId: { type: 'string', description: '文件 ID' },
        sheetName: { type: 'string', description: '工作表名，默认第一个工作表' },
        startRow: { type: 'number', description: '起始行（0 起，含表头行），默认 0' },
        maxRows: { type: 'number', description: '本次最多行数，默认 100，上限 500' },
      },
      required: ['fileId'],
    },
    async execute(args) {
      try {
        const res = await readAgentFileSheet(args.fileId as string, {
          sheetName: args.sheetName as string | undefined,
          startRow: typeof args.startRow === 'number' ? args.startRow : 0,
          maxRows: typeof args.maxRows === 'number' ? args.maxRows : 100,
        });
        const d = res.data;
        return {
          success: true,
          message: `「${d.sheetName}」已读取 ${d.startRow} 行起的 ${d.rows.length} 行（共 ${d.totalRows} 行）${d.nextStartRow != null ? `，可用 startRow=${d.nextStartRow} 继续` : '，已到末尾'}`,
          data: d,
        };
      } catch (e) {
        return { success: false, message: `读取 Excel 失败: ${(e as Error).message}` };
      }
    },
  }),

  'file:import': () => ({
    id: 'file:import',
    category: SkillCategory.FILE,
    name: 'import_rows',
    description: `把用户上传的 Excel 附件批量导入数据源已存在的表（机械分批执行，LLM 只需给出映射，数据量不占用对话上下文）。
前置：先 file_info 获取 headerRowIndex 与 headers → 确定 dataStartRow（默认 headerRowIndex+1）与 columns 映射（sheetCol 是 file_sheet 返回行数组的下标）；目标表必须已存在，建表走 execute_sql（被拦截时按降级契约输出 SQL 并标记 interventionRequired）。
dryRun=true 只渲染前 3 行 SQL 样例不执行，用于向用户确认导入方案。需要用户确认（触发危险操作确认门）。
中断可续传：失败/中止结果里的 nextStartRow 可作为下一次的 dataStartRow（先 SELECT COUNT 防重复插入）。`,
    parameters: {
      type: 'object',
      properties: {
        fileId: { type: 'string', description: '附件文件 ID' },
        sheetName: { type: 'string', description: '工作表名，默认第一个工作表' },
        dataStartRow: { type: 'number', description: '数据起始物理行号（0 起）。默认 = headerRowIndex + 1' },
        datasourceId: { type: 'number', description: '目标数据源 ID' },
        table: { type: 'string', description: '目标表名（必须已存在，字母数字下划线/点或反引号包裹）' },
        columns: {
          type: 'array',
          description: '列映射，由你根据 headers 与目标表结构决定',
          items: {
            type: 'object',
            properties: {
              column: { type: 'string', description: '目标表列名' },
              sheetCol: { type: 'number', description: '源数据列下标（0 起，对应 file_sheet 行数组下标）' },
              type: { type: 'string', description: '值类型：string（默认）/ number / date。纯数字列用 number，非法数字会报错' },
            },
            required: ['column', 'sheetCol'],
          },
        },
        batchSize: { type: 'number', description: '每条 INSERT 语句的行数，默认 200，上限 500' },
        maxRows: { type: 'number', description: '最多导入行数，默认全部' },
        dryRun: { type: 'boolean', description: 'true 时只返回前 3 行 SQL 样例，不执行' },
        onError: { type: 'string', description: '批次失败处理：abort（默认，停止并汇报进度与续传点）/ skip（失败批次逐行重试，跳过坏行继续）' },
      },
      required: ['fileId', 'datasourceId', 'table', 'columns'],
    },
    requiresConfirmation: true,
    async execute(args) {
      const fileId = args.fileId as string;
      const sheetName = args.sheetName as string | undefined;
      const datasourceId = args.datasourceId as number;
      const table = (args.table as string || '').trim();
      const cols = (args.columns as ColumnMapping[] | undefined) || [];
      const batchSize = Math.min(Math.max(1, typeof args.batchSize === 'number' ? args.batchSize : 200), 500);
      const maxRows = typeof args.maxRows === 'number' && args.maxRows > 0 ? args.maxRows : Infinity;
      const dryRun = args.dryRun === true;
      const onError = args.onError === 'skip' ? 'skip' : 'abort';

      if (!isSqlIdentifier(table)) {
        return { success: false, message: `表名不合法: ${table}（只允许字母数字下划线/点，或反引号包裹）` };
      }
      if (cols.length === 0) {
        return { success: false, message: 'columns 映射为空，请根据 file_info 的 headers 提供列映射' };
      }
      for (const c of cols) {
        if (!isSqlIdentifier(c.column)) {
          return { success: false, message: `列名不合法: ${c.column}` };
        }
      }

      try {
        const metaRes = await getAgentFileMeta(fileId);
        if (!metaRes.success) return { success: false, message: metaRes.message };
        const sheets = ((metaRes.data.meta as { sheets?: Array<{ name: string; rows: number; headerRowIndex?: number }> })?.sheets) || [];
        const sheet = sheetName ? sheets.find((s) => s.name === sheetName) : sheets[0];
        if (!sheet) {
          return { success: false, message: `工作表不存在: ${sheetName || '(第一个工作表)'}` };
        }
        const start = typeof args.dataStartRow === 'number' && args.dataStartRow >= 0
          ? args.dataStartRow
          : (sheet.headerRowIndex != null && sheet.headerRowIndex >= 0 ? sheet.headerRowIndex + 1 : 1);

        const prefix = `INSERT INTO ${table} (${cols.map((c) => c.column).join(', ')}) VALUES `;
        const renderRowTuple = (row: string[]): { tuple?: string; error?: string } => {
          const parts: string[] = [];
          for (const c of cols) {
            if (c.sheetCol >= row.length) {
              return { error: `源列 ${c.sheetCol} 超出该行列数 ${row.length}` };
            }
            const v = renderSqlValue(row[c.sheetCol], c.type);
            if (v.error) return { error: `${c.column}: ${v.error}` };
            parts.push(v.sql!);
          }
          return { tuple: `(${parts.join(', ')})` };
        };

        if (dryRun) {
          const page = await readAgentFileSheet(fileId, { sheetName, startRow: start, maxRows: 3 });
          if (!page.success) return { success: false, message: page.message };
          const samples = page.data.rows.map((row, i) => {
            const r = renderRowTuple(row);
            return {
              row: start + i,
              sql: prefix + (r.tuple ?? `-- 渲染失败: ${r.error}`),
              error: r.error,
            };
          });
          return {
            success: true,
            message: `dry-run 样例（未执行）：${sheet.name} 自第 ${start} 行起导入 ${sheet.rows - start} 行到 ${table}`,
            data: { sheetName: sheet.name, totalRows: sheet.rows, startRow: start, batchSize, samples },
          };
        }

        let cursor: number | null = start;
        let imported = 0;
        let skipped = 0;
        let batches = 0;
        const errors: Array<{ row: number; error: string }> = [];

        while (cursor != null && imported + skipped < maxRows) {
          const fetchRows = Math.min(500, maxRows - imported - skipped);
          const page = await readAgentFileSheet(fileId, { sheetName, startRow: cursor, maxRows: fetchRows });
          if (!page.success) {
            return {
              success: false,
              message: `读取第 ${cursor} 行起数据失败: ${page.message}（已导入 ${imported} 行，可从 nextStartRow 续传）`,
              data: { imported, skipped, nextStartRow: cursor },
            };
          }
          const rows = page.data.rows as string[][];
          if (rows.length === 0) break;

          for (let i = 0; i < rows.length; i += batchSize) {
            const chunk = rows.slice(i, i + batchSize);
            const tuples: Array<{ rowNo: number; tuple: string }> = [];
            for (let j = 0; j < chunk.length; j++) {
              const r = renderRowTuple(chunk[j]);
              if (r.error) {
                skipped++;
                if (errors.length < 5) errors.push({ row: cursor + i + j, error: r.error });
                continue;
              }
              tuples.push({ rowNo: cursor + i + j, tuple: r.tuple! });
            }
            if (tuples.length === 0) continue;
            batches++;
            try {
              const res = await executeSql(datasourceId, prefix + tuples.map((t) => t.tuple).join(','));
              if (res && res.success === false) throw new Error(res.message || 'SQL 执行失败');
              imported += tuples.length;
            } catch (e) {
              const msg = (e as Error).message.slice(0, 300);
              if (onError !== 'skip') {
                return {
                  success: false,
                  message: `批次写入失败（第 ${tuples[0].rowNo} 行起，已导入 ${imported} 行）: ${msg}。可从 nextStartRow 续传，或改用 onError=skip 跳过坏行`,
                  data: { imported, skipped, batches, errors, nextStartRow: tuples[0].rowNo },
                };
              }
              // skip：失败批次逐行重试，跳过坏行
              for (const t of tuples) {
                try {
                  const one = await executeSql(datasourceId, prefix + t.tuple);
                  if (one && one.success === false) throw new Error(one.message || 'SQL 执行失败');
                  imported++;
                } catch (e2) {
                  skipped++;
                  if (errors.length < 5) errors.push({ row: t.rowNo, error: (e2 as Error).message.slice(0, 200) });
                }
              }
            }
          }

          cursor = page.data.nextStartRow;
        }

        return {
          success: true,
          message: `导入完成：成功 ${imported} 行，跳过 ${skipped} 行，共 ${batches} 个批次${errors.length ? `；错误样例: ${JSON.stringify(errors)}` : ''}`,
          data: { imported, skipped, batches, errors, nextStartRow: cursor },
        };
      } catch (e) {
        return { success: false, message: `导入失败: ${(e as Error).message}` };
      }
    },
  }),

  'file:run_python': () => ({
    id: 'file:run_python',
    category: SkillCategory.FILE,
    name: 'run_python_code',
    description: `在沙箱里执行你编写的 Python 代码，解析用户上传的附件（适合大文件探查、聚合统计、透视、清洗、格式转换等 file_read/file_sheet 不便胜任的场景）。
契约：
- 代码必须定义 def main(ctx)，返回值必须是可 JSON 序列化的对象
- ctx['_files'][文件名] 是可打开的文件路径；沙箱内可用 pandas / openpyxl / numpy
- Excel 常有合并标题行：先 file_info 看 headerRowIndex，>0 时 read_excel 必须传 header=headerRowIndex，否则表头错位（KeyError）
- 返回值自动清洗：NaN/Inf→null、numpy 标量/日期→原生类型；DataFrame/Series 需先 .to_dict()/抽样转换
- 容器无网络，禁止访问数据库、外部服务或文件目录之外的任何路径
- 返回结果 ≤5000 字符：大结果只返回 shape / 聚合值 / 抽样（head/iloc[:20]）/ 分批多次执行，禁止把全量行塞进返回值；报 SANDBOX_RESULT_TRUNCATED 即返回值超限被截断，继续精简返回值（不是代码问题）
- 代码长度 ≤20000 字符；SANDBOX_POOL_DOWN 表示沙箱池不可用（基础设施故障），不要当代码错误反复重试
- 同一段代码报错禁止原样重试：先分析 stderr 修改代码（列名异常先 print(list(df.columns))）再执行
需要用户确认（触发危险操作确认门）。`,
    parameters: {
      type: 'object',
      properties: {
        fileId: { type: 'string', description: '附件文件 ID' },
        code: {
          type: 'string',
          description: '完整 Python 代码，定义 def main(ctx) 并 return 结果对象。示例：\ndef main(ctx):\n    import pandas as pd\n    df = pd.read_excel(list(ctx["_files"].values())[0], sheet_name=0)\n    return {"shape": list(df.shape), "columns": list(df.columns), "sample": df.head(5).astype(str).values.tolist()}',
        },
      },
      required: ['fileId', 'code'],
    },
    requiresConfirmation: true,
    async execute(args) {
      try {
        const res = await executeAgentFilePython(args.fileId as string, args.code as string);
        const d = res.data;
        if (!d.success) {
          const infra = d.errorCode === 'SANDBOX_POOL_DOWN';
          return {
            success: false,
            message: infra
              ? `沙箱池不可用（${d.stderr || d.errorCode}）。这是基础设施故障，请告知用户稍后重试，不要修改代码重试`
              : `代码执行失败: ${d.stderr || d.errorCode || '未知错误'}`,
            data: d,
          };
        }
        return {
          success: true,
          message: '代码执行成功，返回值见 data.result',
          data: { result: d.result },
        };
      } catch (e) {
        return { success: false, message: `执行失败: ${(e as Error).message}` };
      }
    },
  }),
};
