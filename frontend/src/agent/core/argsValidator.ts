/**
 * 工具参数 schema 预校验（JSON Schema 子集）
 *
 * 背景：工具参数此前只做 JSON 语法校验，形状错误（缺必填字段、类型不符、枚举非法）
 * 要等工具运行期才报错——一次失败烧掉一整个 LLM 迭代。本模块在执行前按工具声明的
 * parameters 做轻量校验，把具体原因直接回喂给模型自修正。
 *
 * 校验哲学（宁漏勿误）：预校验是加速器，不是第二道裁判。
 * - 只拦截确定性违规：缺 required、类型明显不符、enum 不在声明列表；
 * - 兼容模型的无害偏差：数字写入 string 字段（工具侧普遍 String() 宽容）、
 *   可选字段传 null、多余字段（工具自行忽略）；
 * - 未声明 properties/required 的宽松 schema 不校验；内部异常一律放行。
 */

interface JsonSchema {
  type?: string | string[];
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
}

const MAX_ERRORS = 5;
const MAX_DEPTH = 4;

function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return '数组';
  switch (typeof value) {
    case 'string': return `字符串 "${value.slice(0, 40)}"`;
    case 'number': return `数字 ${value}`;
    case 'boolean': return `布尔值 ${value}`;
    case 'object': return '对象';
    default: return typeof value;
  }
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'number':
    case 'integer': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: return true; // 未认识的类型声明不拦
  }
}

/** 无损可纠错的跨类型偏差放行：数字→string（工具侧 String() 宽容）、数值字符串→number */
function isBenignCrossType(value: unknown, types: string[]): boolean {
  if (typeof value === 'number' && types.includes('string')) return true;
  if (typeof value === 'string' && types.includes('number') && value.trim() !== '' && Number.isFinite(Number(value))) return true;
  return false;
}

function validateNode(path: string, value: unknown, schema: JsonSchema, errors: string[], depth: number): void {
  if (errors.length >= MAX_ERRORS || depth > MAX_DEPTH) return;

  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length > 0 && !types.some((t) => matchesType(value, t))) {
    if (!isBenignCrossType(value, types)) {
      errors.push(`字段${path || '（根）'} 应为 ${types.join('|')}，实际为 ${describeValue(value)}`);
      return;
    }
  }

  if (schema.enum && !schema.enum.some((e) => e === value)) {
    errors.push(`字段${path || '（根）'} 应为 ${schema.enum.map((e) => `"${String(e)}"`).join('|')} 之一，实际为 ${describeValue(value)}`);
    return;
  }

  if (Array.isArray(schema.properties)) return; // 非法 schema，放行
  if (schema.properties && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const key of schema.required || []) {
      if (!(key in value) || (value as Record<string, unknown>)[key] === undefined) {
        errors.push(`缺少必填字段 "${key}"`);
      }
    }
    for (const [key, child] of Object.entries(schema.properties)) {
      const childValue = (value as Record<string, unknown>)[key];
      // 可选字段的 null 不拦（模型常用 null 表示"未提供"）
      if (childValue === null || childValue === undefined) continue;
      validateNode(path ? `${path}.${key}` : key, childValue, child, errors, depth + 1);
    }
  }

  if (schema.items && Array.isArray(value)) {
    value.forEach((item, i) => validateNode(`${path}[${i}]`, item, schema.items!, errors, depth + 1));
  }
}

/**
 * 校验工具参数是否符合声明的 schema。返回错误列表（中文、可直接回喂模型），
 * 空数组表示通过（或 schema 过于宽松无需校验）。
 */
export function validateToolArgs(args: Record<string, unknown>, parameters: unknown): string[] {
  try {
    const schema = parameters as JsonSchema | undefined;
    if (!schema || typeof schema !== 'object') return [];
    // 宽松 schema（无 properties 也无 required，如无参工具）：无从校验，直接放行
    if (!schema.properties && !schema.required && !schema.enum) return [];
    const errors: string[] = [];
    validateNode('', args, schema, errors, 0);
    return errors;
  } catch {
    return []; // 校验器自身异常绝不阻塞工具执行
  }
}
