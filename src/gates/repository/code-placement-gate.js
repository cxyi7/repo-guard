import { defineGate } from '../../core/capability/gate-definition.js';
import { readProjectTextFiles } from '../../core/project/text-files.js';
import { listIndexFiles, readIndexTextFiles } from '../../git/index-content.js';
import {
  inspectCodePlacement,
  selectCodePlacementFiles,
} from '../../policies/code-placement.js';
import { passedResult, skippedResult, violationResult } from '../native-result.js';

function candidatePaths({ root, environment, files }) {
  if (environment === 'pre-commit') return listIndexFiles(root);
  return files.map((file) => (typeof file === 'string' ? file : file.relative));
}

function candidateContents({ root, environment, paths }) {
  return environment === 'pre-commit'
    ? readIndexTextFiles(root, paths)
    : readProjectTextFiles(root, paths);
}

export const codePlacementGate = defineGate({
  id: 'repository.code-placement',
  configKey: 'codePlacement',
  featureName: 'codePlacement',
  featureOrder: 45,
  configVersions: [1],
  environments: ['manual', 'pre-commit', 'ci-policy', 'ci-full', 'release-ready'],
  mutation: 'read-only',
  defaultTimeoutMs: 120000,
  manualCommand: 'code-placement',
  manualOrder: 155,
  doctorOrder: 155,
  packageScript: 'guard:code-placement',
  inspectSetup: ({ config }) => ({
    status: 'ready',
    summary: config.codePlacement.enabled ? '代码位置策略已启用' : '代码位置策略已禁用',
  }),
  plan(context) {
    const enabled = context.environment === 'manual' || context.config.codePlacement.enabled;
    if (!enabled || context.config.codePlacement.rules.length === 0) {
      return { enabled, files: [] };
    }
    const paths = selectCodePlacementFiles(
      candidatePaths(context),
      context.config.codePlacement,
    );
    return {
      enabled,
      files: candidateContents({ ...context, paths }),
    };
  },
  run({ config, plan }) {
    if (!plan.enabled) {
      return skippedResult('repository.code-placement', '代码位置策略已禁用');
    }
    const result = inspectCodePlacement({ files: plan.files, config: config.codePlacement });
    if (result.violations.length === 0) {
      return passedResult(
        'repository.code-placement',
        '代码位置策略已通过',
        { metrics: { checkedFiles: result.checkedCount } },
      );
    }
    return violationResult(
      'repository.code-placement',
      `代码位置策略发现 ${result.violations.length} 项违规`,
      {
        findings: result.violations.map(({ line, path: filePath, rule }) => ({
          ruleId: 'repository/code-placement',
          severity: 'error',
          message: `${filePath} 第 ${line} 行出现了只允许放在指定文件中的代码（${rule.name}）`,
          location: { path: filePath, line },
          evidence: [{ message: `允许文件：${rule.allowedFiles.join('、')}` }],
          expected: `该代码只能出现在：${rule.allowedFiles.join('、')}`,
          remediation: {
            goal: '删除或迁移错误位置中的受限代码',
            steps: [
              `从 ${filePath} 删除该代码`,
              '如果业务确实需要新位置，先评审并更新 codePlacement.allowedFiles',
            ],
            constraints: ['不得通过改写或拆分受限代码来绕过位置策略'],
            verification: ['重新运行 repo-guard code-placement'],
          },
        })),
        metrics: {
          checkedFiles: result.checkedCount,
          violations: result.violations.length,
        },
      },
    );
  },
});
