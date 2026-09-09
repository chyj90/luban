/**
 * Agent 自检 + 回归评测的 Node 运行入口（CI / 本地：npm run agent:check）
 *
 * 用 tsx 直接执行（npx -y tsx），需先安装浏览器全局对象桩，
 * 因为部分被导入模块在模块级/调用级会触碰 localStorage / indexedDB / crypto。
 */
const g = globalThis as Record<string, unknown>;

if (!g.localStorage) {
  g.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  };
}
if (!g.indexedDB) {
  g.indexedDB = {} as IDBFactory;
}
if (!(g.crypto as { randomUUID?: unknown } | undefined)?.randomUUID) {
  g.crypto = {
    randomUUID: () => `uuid-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`,
  };
}

/** Node 退出（避免依赖 @types/node：前端 tsconfig 无 process 类型声明） */
function exitWithCode(code: number): void {
  const proc = (globalThis as { process?: { exit: (c?: number) => void } }).process;
  if (proc) proc.exit(code);
}

async function main(): Promise<void> {
  const { runConsistencyCheck } = await import('./agentSelfCheck');
  const { runAgentEvalsAndReport } = await import('./test/agentEvals');

  console.log('=== Agent 自检（R1 提示词-工具一致性） ===');
  const violations = runConsistencyCheck();
  if (violations.length === 0) {
    console.log('✅ 一致性校验通过');
  } else {
    console.error(`❌ ${violations.length} 处不一致：`);
    for (const v of violations) {
      console.error(`  - [${v.agentId}] ${v.source}: ${v.toolName} | ${v.reason}`);
    }
  }

  console.log('\n=== Agent 回归评测（R11 首批） ===');
  const evalsPassed = await runAgentEvalsAndReport();

  if (violations.length > 0 || !evalsPassed) {
    console.error('\n[agent:check] ❌ 自检未通过');
    exitWithCode(1);
    return;
  }
  console.log('\n[agent:check] ✅ 全部通过');
}

main().catch((e) => {
  console.error('[agent:check] 运行异常:', e);
  exitWithCode(1);
});
