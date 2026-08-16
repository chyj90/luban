import type { ToolDefinition, ToolContext } from '@/types/agent';
import type { ChatRouter } from '../core/chatRouter';
import { getAgentMemory, setAgentMemory } from './agentMemory';

export interface FindAnalysisArgs {
  user_request: string;
}

export interface FindAnalysisResult {
  success: boolean;
  report: string;
}

export function createFindAnalysisTool(context: ToolContext, chatRouter: ChatRouter): ToolDefinition {
  return {
    name: 'analyze_requirement',
    description: `委派给需求分析助手，从业务视角分析用户需求。
分析助手会完成：
1. 话题拆解 - 将需求拆分为独立子任务
2. 逐话题分析 - UI布局、业务数据、查询结构、API需求
3. 冲突合并 - 识别并合并重复的Query和数据
4. 输出分析报告
分析结果包含完整的页面布局图、数据字段列表、Query输入输出定义。
使用时机：收到用户需求后，在创建计划之前调用。`,
    category: 'analysis',
    parameters: {
      type: 'object',
      properties: {
        user_request: {
          type: 'string',
          description: '用户的原始需求描述，完整传入',
        },
      },
      required: ['user_request'],
    },
    async execute(args) {
      const typedArgs = args as unknown as FindAnalysisArgs;
      const execStart = Date.now();

      console.log(`[analyze_requirement] 开始执行 | request=${typedArgs.user_request.slice(0, 100)}`);

      context.dispatch({
        type: 'ANALYSIS_START',
        payload: { request: typedArgs.user_request },
      });

      try {
        const userMessage = `请分析以下用户需求：\n\n${typedArgs.user_request}`;

        console.log(`[analyze_requirement] 委派 analysis-assistant | 消息长度: ${userMessage.length}`);
        const routeStart = Date.now();
        const executor = await chatRouter.routeTo('analysis-assistant', userMessage, `analysis-${Date.now()}`, {
          isDelegated: true,
          initialMessages: getAgentMemory(context.applicationId, 'analysis-assistant'),
        });
        setAgentMemory(context.applicationId, 'analysis-assistant', executor.getMessages());
        console.log(`[analyze_requirement] analysis-assistant 委派完成 | ${Date.now() - routeStart}ms`);

        const messages = executor.getMessages();
        const report = messages
          .filter((m) => m.role === 'assistant')
          .map((m) => m.content)
          .join('\n\n');

        const result: FindAnalysisResult = {
          success: true,
          report,
        };

        context.dispatch({
          type: 'ANALYSIS_COMPLETE',
          payload: result,
        });
        console.log(`[analyze_requirement] 完成 | 总耗时 ${Date.now() - execStart}ms`);

        return result;
      } catch (e) {
        const errorResult: FindAnalysisResult = {
          success: false,
          report: `需求分析失败: ${(e as Error).message}`,
        };

        console.log(`[analyze_requirement] 执行失败 | ${(e as Error).message}`);
        context.dispatch({
          type: 'ANALYSIS_COMPLETE',
          payload: errorResult,
        });

        return errorResult;
      }
    },
  };
}

export function getFindAnalysisSkillSummary(): string {
  return `## 需求分析
- 收到用户需求后，**必须先调用 analyze_requirement**，将需求委派给需求分析助手
- 分析助手会从业务视角完成：话题拆解、UI布局、数据字段、Query设计、流程分析、冲突合并
- 分析助手会同步创建执行计划（create_plan），你不需要再创建计划
- 分析助手返回报告和计划后，展示给用户确认，确认后调用 confirm_plan 开始执行
- 不要在分析阶段调用其他工具（数据操作、创建页面等）
- 分析助手不知道数据库结构，所以分析结果中的字段都是业务语言描述的`;
}