import { loadConfig } from '../../config/configuration-loader.js';
import {
  DEFAULT_ACCESSIBILITY_TEST_CONFIG,
  DEFAULT_ARCHITECTURE_CONFIG,
  DEFAULT_BUILD_CONFIG,
  DEFAULT_TYPE_CHECK_CONFIG,
  DEFAULT_UNIT_TEST_CONFIG,
} from '../../config/defaults.js';
import { CONFIG_FILE } from '../../config/validation-primitives.js';
import { writeConsoleMessage } from '../../core/report/console-renderer.js';
import { detectProjectArchitectureSetup } from '../../gates/quality/architecture-setup.js';
import { detectProjectBuildSetup } from '../../gates/quality/build-setup.js';
import { detectProjectStylelintSetup } from '../../gates/quality/stylelint-setup.js';
import { detectProjectTypeCheckSetup } from '../../gates/quality/typecheck-setup.js';
import {
  detectProjectAccessibilityTestSetup,
} from '../../gates/testing/accessibility-test-setup.js';
import { detectProjectUnitTestSetup } from '../../gates/testing/unit-test-setup.js';
import { findRepositoryRoot } from '../../git/repository.js';
import {
  AGENT_POLICY_FILE,
  syncAgentPolicies,
} from '../../policies/agent-policies.js';
import { ensureProjectConfig } from './config-management.js';
import { installHooks } from './hook-installer.js';

export function runInit(cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const architectureSetup = detectProjectArchitectureSetup(
    root,
    DEFAULT_ARCHITECTURE_CONFIG,
  );
  const accessibilityTestSetup = detectProjectAccessibilityTestSetup(
    root,
    DEFAULT_ACCESSIBILITY_TEST_CONFIG,
  );
  const buildSetup = detectProjectBuildSetup(root, DEFAULT_BUILD_CONFIG);
  const stylelintSetup = detectProjectStylelintSetup(root);
  const typeCheckSetup = detectProjectTypeCheckSetup(root, DEFAULT_TYPE_CHECK_CONFIG);
  const unitTestSetup = detectProjectUnitTestSetup(root, DEFAULT_UNIT_TEST_CONFIG);
  const { created: configCreated } = ensureProjectConfig(root, {
    accessibilityTestEnabled: accessibilityTestSetup.ready,
    architectureEnabled: architectureSetup.ready,
    buildEnabled: buildSetup.ready,
    stylelintEnabled: stylelintSetup.ready,
    typeCheckEnabled: typeCheckSetup.ready,
    unitTestEnabled: unitTestSetup.ready,
  });
  const result = installHooks({
    cwd: root,
    updatePackageScripts: true,
  });
  const config = loadConfig(root);
  const agentPolicy = syncAgentPolicies(root, config);

  writeConsoleMessage(`repo-guard 已在以下目录完成初始化：${root}`);
  writeConsoleMessage(`- Git Hook 路径：${result.hooksPath}`);
  writeConsoleMessage(`- 已安装的 Git Hook：${result.hooks.join(', ')}`);
  writeConsoleMessage(`- Git 属性文件 .gitattributes：${result.gitAttributes.changed ? '已更新' : '已保留'}`);
  writeConsoleMessage(
    `- Git 忽略文件 .gitignore：${result.localEnvironment.gitIgnore.changed ? '已更新' : '已保留'}`,
  );
  writeConsoleMessage(
    `- 环境配置 .env.config：${result.localEnvironment.envFile.created ? '已创建' : '已保留'}`,
  );
  writeConsoleMessage(`- 配置：${CONFIG_FILE}${configCreated ? '（已创建）' : '（已保留）'}`);
  writeConsoleMessage(
    `- ${AGENT_POLICY_FILE}：${agentPolicy.changed ? '已同步' : '已是最新状态'}（项目托管规范）`,
  );
  if (configCreated && stylelintSetup.ready) {
    writeConsoleMessage(
      `- Stylelint ${stylelintSetup.metadata.version}：已启用，使用 ${stylelintSetup.configFile}`,
    );
  } else if (configCreated) {
    writeConsoleMessage('- Stylelint：已禁用；项目安装 Stylelint 并添加配置后可启用');
  }
  if (configCreated) {
    writeConsoleMessage(
      architectureSetup.ready
        ? `- 架构检查：已启用，使用 dependency-cruiser ${architectureSetup.setup.dependencyCruiser.version}`
        : '- 架构检查：已禁用；项目安装 dependency-cruiser 并提供 src 后可启用',
    );
    writeConsoleMessage(
      buildSetup.ready
        ? `- 构建：已启用，使用 npm 脚本 "${DEFAULT_BUILD_CONFIG.script}"`
        : '- 构建：已禁用；项目添加构建脚本后可启用',
    );
    writeConsoleMessage('- Lighthouse：已禁用；Vue 项目添加 @lhci/cli 和 lighthouserc 后可启用');
    writeConsoleMessage(
      typeCheckSetup.ready
        ? `- TypeScript：已启用，使用 npm 脚本 "${DEFAULT_TYPE_CHECK_CONFIG.script}"`
        : '- TypeScript：已禁用；项目添加 typecheck 脚本后可启用',
    );
    writeConsoleMessage(
      unitTestSetup.ready
        ? `- 单元测试：已启用，使用 npm 脚本 "${DEFAULT_UNIT_TEST_CONFIG.script}"`
        : '- 单元测试：已禁用；项目安装 Vitest 并添加 test:unit 后可启用',
    );
    writeConsoleMessage(
      accessibilityTestSetup.ready
        ? `- 无障碍测试：已启用，使用 npm 脚本 "${DEFAULT_ACCESSIBILITY_TEST_CONFIG.script}"`
        : '- 无障碍测试：已禁用；项目添加完整的 axe test:a11y 设置后可启用',
    );
  }
  writeConsoleMessage('- 配置通知环境变量后运行 "repo-guard doctor"');
  return 0;
}
