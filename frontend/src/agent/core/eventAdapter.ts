import type { AgentEvent, AgentEventHandler } from '@dudko.dev/agent-web';
import type { AgentEvent as AppAgentEvent, Message, Plan, Step } from '@/types/agent';

interface EventAdapterDeps {
  addMessage: (msg: Message) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;
  setStatus: (status: string) => void;
  setStreaming: (isStreaming: boolean) => void;
  setError: (error: string) => void;
  addPlan: (plan: Plan) => void;
  updatePlan: (planId: string, updates: Partial<Plan>) => void;
  updateStep: (planId: string, stepId: string, updates: Partial<Step>) => void;
  dispatch: (event: AppAgentEvent) => void;
  onPlanCreated: (hasAutoMarker: boolean) => void;
  onStepBlocked: () => void;
  agentId: string;
  agentName: string;
  agentIcon: string;
}

export function createEventAdapter(deps: EventAdapterDeps): AgentEventHandler {
  const {
    addMessage,
    updateMessage,
    setStatus,
    setStreaming,
    setError,
    addPlan,
    updatePlan,
    updateStep,
    dispatch,
    onPlanCreated,
    onStepBlocked,
    agentId,
    agentName,
    agentIcon,
  } = deps;

  let streamingMsgId = '';
  let streamingContent = '';
  let planId = '';

  const cleanDesc = (desc: string) => desc.replace(/^\[AUTO\]\s*/, '').replace(/\s*\[BLOCKER\]$/, '');

  function flushStreamingMessage() {
    if (streamingContent) {
      if (!streamingMsgId) {
        streamingMsgId = crypto.randomUUID();
        addMessage({
          id: streamingMsgId,
          role: 'assistant',
          content: streamingContent,
          timestamp: Date.now(),
          agentId,
          agentName,
          agentIcon,
        });
      } else {
        updateMessage(streamingMsgId, {
          content: streamingContent,
          isStreaming: false,
        });
      }
      streamingMsgId = '';
      streamingContent = '';
    }
    setStreaming(false);
  }

  function appendStreamingDelta(delta: string) {
    streamingContent += delta;
  }

  return (event: AgentEvent) => {
    const ts = new Date().toISOString().slice(11, 23);
    const prefix = `[${ts}][${agentName}]`;

    switch (event.type) {
      case 'run.start':
        console.log(`${prefix} run.start`);
        setStatus('planning');
        streamingMsgId = crypto.randomUUID();
        addMessage({
          id: streamingMsgId,
          role: 'assistant',
          content: '正在分析需求...',
          timestamp: Date.now(),
          isStreaming: true,
          agentId,
          agentName,
          agentIcon,
        });
        setStreaming(true);
        break;

      case 'plan.step-added':
        console.log(`${prefix} plan.step-added: "${cleanDesc(event.step.description)}" (index: ${event.index})`);
        if (streamingMsgId) {
          updateMessage(streamingMsgId, {
            content: `正在规划步骤 ${event.index + 1}：${cleanDesc(event.step.description)}`,
          });
        }
        break;

      case 'plan.thought-delta':
        console.log(`${prefix} plan.thought-delta: ${event.delta.slice(0, 200)}${event.delta.length > 200 ? '...' : ''}`);
        appendStreamingDelta(event.delta);
        break;

      case 'plan.created': {
        const stepCount = event.plan.steps.length;
        const steps: Step[] = event.plan.steps.map((s, i) => ({
          id: s.id,
          description: cleanDesc(s.description),
          status: 'pending' as const,
          order: i,
        }));
        console.log(`${prefix} plan.created: ${stepCount} steps`, steps.map((s) => s.description));
        const hasAutoMarker = event.plan.steps.some(
          (s: any) => s.description.startsWith('[AUTO]') || s.description.includes('[BLOCKER]'),
        );
        if (!hasAutoMarker) {
          planId = crypto.randomUUID();
          addPlan({
            id: planId,
            agentId,
            agentName,
            agentIcon,
            steps,
            createdAt: Date.now(),
            status: 'draft',
          });
          if (streamingMsgId) {
            const planSummary = steps.map((s, i) => `${i + 1}. ${s.description}`).join('\n');
            updateMessage(streamingMsgId, { content: planSummary });
          }
          flushStreamingMessage();
        }
        onPlanCreated(hasAutoMarker);
        break;
      }

      case 'step.start': {
        console.log(`${prefix} step.start: "${cleanDesc(event.step.description)}" (id: ${event.step.id})`);
        if (planId) {
          updateStep(planId, event.step.id, { status: 'running' });
        }
        setStatus('executing');
        streamingContent = '';
        setStreaming(true);
        break;
      }

      case 'step.text-delta':
        console.log(`${prefix} step.text-delta: ${event.delta.slice(0, 200)}${event.delta.length > 200 ? '...' : ''}`);
        appendStreamingDelta(event.delta);
        break;

      case 'step.tool-call':
        console.log(`${prefix} step.tool-call: ${event.name}`, JSON.stringify(event.input, null, 2));
        break;

      case 'step.tool-result': {
        const resultPreview = typeof event.output === 'string'
          ? event.output.slice(0, 300)
          : JSON.stringify(event.output).slice(0, 300);
        console.log(`${prefix} step.tool-result: ${event.ok ? 'OK' : 'ERR'} ${resultPreview}${String(event.output).length > 300 ? '...' : ''}`);
        if (!event.ok && planId) {
          updateStep(planId, event.step.id, { status: 'error' });
        }
        break;
      }

      case 'step.complete': {
        console.log(`${prefix} OK step.complete: "${cleanDesc(event.step.description)}" blocked=${event.result.blocked} summary="${event.result.summary}"`);
        if (planId) {
          updateStep(planId, event.step.id, {
            status: event.result.blocked ? 'error' : 'done',
            result: event.result.summary,
          });
          if (event.result.blocked) {
            console.log(`${prefix} step blocked, aborting...`);
            onStepBlocked();
          }
        }
        flushStreamingMessage();
        break;
      }

      case 'plan.revised': {
        console.log(`${prefix} 轮 plan.revised: ${event.plan?.steps.length} steps`, event.plan?.steps.map((s: any) => cleanDesc(s.description)));
        if (planId && event.plan) {
          const revisedSteps: Step[] = event.plan.steps.map((s, i) => ({
            id: s.id,
            description: cleanDesc(s.description),
            status: 'pending' as const,
            order: i,
          }));
          updatePlan(planId, { steps: revisedSteps });
        }
        break;
      }

      case 'final.text-delta':
        console.log(`${prefix} final.text-delta: ${event.delta.slice(0, 200)}${event.delta.length > 200 ? '...' : ''}`);
        appendStreamingDelta(event.delta);
        break;

      case 'final': {
        console.log(`${prefix} 开始 final: text=${event.text?.slice(0, 100) || '(none)'}`);
        flushStreamingMessage();
        if (event.text) {
          addMessage({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: event.text,
            timestamp: Date.now(),
            agentId,
            agentName,
            agentIcon,
          });
        }
        if (planId) {
          updatePlan(planId, { status: 'completed' });
        }
        setStatus('completed');
        break;
      }

      case 'usage': {
        console.log(`${prefix} usage: phase=${event.phase} input=${event.usage.inputTokens} output=${event.usage.outputTokens} total=${event.usage.totalTokens}`);
        dispatch({
          type: 'TOKEN_USAGE',
          payload: {
            phase: event.phase,
            inputTokens: event.usage.inputTokens,
            outputTokens: event.usage.outputTokens,
            totalTokens: event.usage.totalTokens,
          },
        });
        break;
      }

      case 'error':
        console.error(`${prefix} ERR error:`, event.error);
        setError(event.error);
        setStreaming(false);
        break;

      case 'stopped':
        console.log(`${prefix} STOP stopped`);
        setStatus('cancelled');
        setStreaming(false);
        break;
    }
  };
}