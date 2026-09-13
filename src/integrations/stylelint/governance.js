import { createRequire } from 'node:module';
import path from 'node:path';
import selectorParser from 'postcss-selector-parser';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { resolveProjectPackageMetadata } from '../../core/project/package.js';
import { inspectStyleGovernanceFacts } from '../../policies/style-governance.js';
import {
  inspectProjectStylelintRuleInputs,
  executeProjectStylelintRules,
} from './execution.js';

/** 使用消费项目 Vue 编译器识别真实 SFC 样式块。 */
function vueFacts(root, file, source) {
  const metadata = resolveProjectPackageMetadata(root, 'vue', 'Vue 样式解析器');
  const compiler = createRequire(metadata.packagePath)('vue/compiler-sfc');
  const { descriptor, errors } = compiler.parse(source, { filename: file });
  if (errors.length)
    throw configurationError(
      'stylelint/vue-parse-failed',
      'Vue 单文件组件无法解析，请修复语法后重新检查。',
      {
        details: {
          diagnostics: [
            {
              source: 'vue',
              level: 'error',
              message:
                '第三方原始诊断：' +
                errors.map((e) => e.message ?? String(e)).join('\n'),
            },
          ],
        },
      },
    );
  return descriptor.styles.map((block) => ({
    isolated: Boolean(block.scoped || block.module),
    line: block.loc.start.line,
    column: block.loc.start.column,
  }));
}

/** 用项目 Stylelint 语法解析，选择器 AST 只负责识别全局逃逸。 */
export async function inspectStyleGovernance({
  project,
  root,
  files,
  options,
  governance,
}) {
  const inputs = await inspectProjectStylelintRuleInputs({
    project,
    root,
    files,
    options,
  });
  const output = [];
  for (const input of inputs) {
    const relative = path.relative(root, input.file).replaceAll('\\', '/');
    const blocks = relative.endsWith('.vue')
      ? vueFacts(root, input.file, input.code)
      : null;
    const escapes = [];
    const ruleName = 'repo-guard/style-governance-facts';
    const plugin = project.stylelint.createPlugin(ruleName, () => (ast) => {
      ast.walkRules((node) => {
        selectorParser((selectors) =>
          selectors.walkPseudos((pseudo) => {
            if ([':global', '::v-global'].includes(pseudo.value))
              escapes.push({
                line: node.source?.start?.line ?? 1,
                column: node.source?.start?.column ?? 1,
              });
          }),
        ).processSync(node.selector);
      });
    });
    const report = await executeProjectStylelintRules({
      project,
      root,
      bypassProjectIgnores: true,
      inputs: [
        {
          ...input,
          config: { plugins: [plugin], rules: { [ruleName]: true } },
        },
      ],
    });
    if (
      report.results.some(
        (r) =>
          r.errored || r.parseErrors?.length || r.invalidOptionWarnings?.length,
      )
    )
      throw configurationError(
        'stylelint/governance-parse-failed',
        '样式治理无法解析当前样式，请核对项目语法配置。',
        {
          details: {
            diagnostics: [
              {
                source: 'stylelint',
                level: 'error',
                message: '第三方原始诊断：' + JSON.stringify(report.results),
              },
            ],
          },
        },
      );
    output.push({
      source: input.file,
      warnings: inspectStyleGovernanceFacts({
        relative,
        blocks,
        escapes,
        allowedPatterns: governance.allowedGlobalStylePatterns,
      }),
    });
  }
  return output;
}
