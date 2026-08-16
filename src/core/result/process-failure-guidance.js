import { internalError } from '../error/repo-guard-error.js';

const PROCESS_FAILURES = Object.freeze({
  'quality.typecheck': Object.freeze({
    ruleId: 'typescript/typecheck-process',
    message: '项目 TypeScript 检查报告了错误',
    evidence: '使用方项目的 tsc/vue-tsc 进程未成功退出。',
    remediation: ({ script }) => ({
      step: `修复报告中的类型错误及受影响的调用方，然后运行 npm run ${script}。`,
      constraint: '不得使用 any、@ts-ignore、@ts-nocheck、关闭严格模式或修改规则来绕过门禁。',
    }),
  }),
  'quality.build': Object.freeze({
    ruleId: 'build/project-process',
    message: '使用方项目构建报告了错误',
    evidence: '项目自有的构建脚本未成功退出。',
    remediation: ({ script }) => ({
      step: `修复报告中的源码、配置、依赖或资源错误，然后运行 npm run ${script}。`,
      constraint: '不得将构建替换为空操作、忽略失败、关闭生产检查或削弱门禁。',
    }),
  }),
  'quality.unit-test': Object.freeze({
    ruleId: 'testing/unit-test-process',
    message: '使用方项目单元测试报告了失败',
    evidence: '项目自有的 Vitest 进程未成功退出。',
    remediation: ({ script }) => ({
      step: `修复失败的行为或测试，然后运行 npm run ${script}。`,
      constraint: '不得删除测试或断言、使用 skip/todo/only，或削弱门禁。',
    }),
  }),
  'quality.accessibility-test': Object.freeze({
    ruleId: 'accessibility/axe-test-process',
    message: '使用方项目无障碍测试报告了违规',
    evidence: '项目自有的 axe 测试进程未成功退出。',
    remediation: ({ script }) => ({
      step: `修复报告中的无障碍问题根因和回归测试，然后运行 npm run ${script}。`,
      constraint: '不得关闭规则、排除节点、缩小扫描范围、删除断言或削弱门禁。',
    }),
  }),
  'quality.lighthouse:build': Object.freeze({
    ruleId: 'lighthouse/build-process',
    message: 'Lighthouse 项目构建报告了错误',
    evidence: 'Lighthouse 使用的项目构建进程未成功退出。',
    remediation: ({ script }) => ({
      step: `修复项目构建，并在运行 Lighthouse 前执行 npm run ${script}。`,
      constraint: null,
    }),
  }),
  'quality.lighthouse:collect': Object.freeze({
    ruleId: 'lighthouse/collect-process',
    message: 'Lighthouse 无法采集已配置的路由',
    evidence: '使用方项目的 LHCI collect 进程未成功退出。',
    remediation: () => ({
      step: '修复使用方项目的 Chrome、服务器、路由或 LHCI 配置，然后重新运行 Lighthouse 门禁。',
      constraint: '不得删除必需路由或削弱已配置的断言。',
    }),
  }),
  'quality.lighthouse:assert': Object.freeze({
    ruleId: 'lighthouse/assert-process',
    message: 'Lighthouse 断言未满足项目策略',
    evidence: '使用方项目的 LHCI assert 进程未成功退出。',
    remediation: () => ({
      step: '修复检测到的无障碍、性能、最佳实践或 SEO 回归，然后重新运行 Lighthouse 门禁。',
      constraint: '不得通过降低断言或删除路由来绕过门禁。',
    }),
  }),
  'quality.unit-test:coverage-report': Object.freeze({
    ruleId: 'coverage/report-generation',
    message: '无法检查覆盖率报告',
    evidence: '配置要求的 json-summary 或 LCOV 输出缺失或无效。',
    remediation: ({ script }) => ({
      step: `配置 Vitest 生成最新的 json-summary 和 LCOV 报告，然后运行 npm run ${script}。`,
      constraint: '不得复用过期报告、关闭覆盖率或降低阈值。',
    }),
  }),
});

export function processFailureFinding(gateId, {
  exitCode,
  phase = null,
  script = null,
} = {}) {
  const key = phase ? `${gateId}:${phase}` : gateId;
  const guidance = PROCESS_FAILURES[key];
  if (!guidance) {
    throw internalError(
      'reporting/missing-process-guidance',
      `未注册对应的进程失败处理指引： ${key}`,
    );
  }
  const remediation = guidance.remediation({ script });
  return {
    ruleId: guidance.ruleId,
    code: `${guidance.ruleId}/process-failed`,
    severity: 'error',
    message: guidance.message,
    evidence: [{
      type: 'process-exit',
      source: key,
      message: `${guidance.evidence}${exitCode == null ? '' : ` 退出码：${exitCode}。`}`,
    }],
    expected: `${key} 进程必须成功完成，退出码应为 0。`,
    remediation: {
      goal: `在不削弱策略的前提下，使 ${key} 恢复通过状态。`,
      steps: [remediation.step],
      constraints: remediation.constraint ? [remediation.constraint] : [],
      verification: [script ? `运行 npm run ${script}。` : `重新运行 ${key} 门禁。`],
    },
    decision: {
      aiAction: 'inspect-diagnostics-and-modify-code',
      humanApprovalRequired: false,
    },
  };
}

export const processFailureGuidanceIds = Object.freeze(Object.keys(PROCESS_FAILURES));
