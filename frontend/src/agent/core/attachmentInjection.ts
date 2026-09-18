/**
 * 附件 → LLM 上下文注入块。
 *
 * 两段式策略（控制 token 成本）：
 * - 提取文本 ≤ INLINE_CHAR_THRESHOLD 的小文件直接内联全文（previewText 由后端上传响应给出）；
 * - 超过的只注入元信息卡（概要 + 表头/预览行），模型用 file_read / file_sheet 按需分页读取。
 * - 内联总量受 INLINE_TOTAL_BUDGET 约束，超预算的附件退化为元信息卡。
 *
 * 安全：内容包在 <user_attachments> 标签内，系统提示词声明这是用户材料而非指令，
 * 缓解文件内容携带提示注入的风险。
 */
import type { AttachmentMeta } from '@/types/agent';

/** 单文件全文内联阈值（字符） */
export const INLINE_CHAR_THRESHOLD = 8000;
/** 全部附件内联总量预算（字符） */
export const INLINE_TOTAL_BUDGET = 24000;

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

const TYPE_LABEL: Record<AttachmentMeta['fileType'], string> = {
  word: 'word',
  text: 'text',
  excel: 'excel',
};

export function buildAttachmentInjection(attachments: AttachmentMeta[]): string | null {
  if (attachments.length === 0) return null;

  const lines: string[] = ['<user_attachments>'];
  let budget = INLINE_TOTAL_BUDGET;

  attachments.forEach((att, idx) => {
    const no = idx + 1;
    const failed = att.parseStatus === 'failed';
    lines.push(`${no}. [fileId=${att.fileId}] ${att.name}（${TYPE_LABEL[att.fileType] || att.ext}/${formatSize(att.size)}）`);

    if (failed) {
      lines.push('   （该文件解析失败，内容不可用）');
      return;
    }
    if (att.summary) {
      lines.push(`   概要：${att.summary}`);
    }

    const preview = att.previewText || '';
    const canInline = !!preview && preview.length <= INLINE_CHAR_THRESHOLD && preview.length <= budget;
    if (canInline) {
      budget -= preview.length;
      lines.push(`   全文（${att.contentChars ?? preview.length}字）：`);
      lines.push(preview);
    } else if (att.fileType === 'excel') {
      lines.push('   完整数据请用工具 file_sheet 按行读取（可先用 file_info 查看各工作表表头），不要凭概要猜测数据内容。');
    } else {
      lines.push(`   全文较长（${att.contentChars ?? '未知'}字，可能被截断），请用工具 file_read 分页读取，不要凭概要猜测内容。`);
    }
  });

  lines.push('</user_attachments>');
  return lines.join('\n');
}
