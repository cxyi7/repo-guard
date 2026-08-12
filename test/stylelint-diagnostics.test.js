import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { buildStylelintAiRepairInstructions } from '../src/stylelint-diagnostics.js';

test('builds one numbered AI repair instruction for each Stylelint problem', () => {
  const root = path.resolve('fixture');
  const output = buildStylelintAiRepairInstructions({
    root,
    maxWarnings: 0,
    results: [
      {
        source: path.join(root, 'src', 'views', 'home', 'index.vue'),
        warnings: [
          {
            column: 5,
            line: 128,
            rule: 'property-no-unknown',
            severity: 'error',
            text: 'Unexpected unknown property "widht" (property-no-unknown)',
          },
        ],
      },
    ],
  });

  assert.match(
    output,
    /1\. 请修复 src\/views\/home\/index\.vue 第 128 行第 5 列的 Stylelint 问题。/,
  );
  assert.match(output, /规则：property-no-unknown/);
  assert.match(output, /请检查属性拼写/);
  assert.match(output, /不得关闭或降级规则/);
});

test('includes invalid Stylelint rule options in AI repair instructions', () => {
  const root = path.resolve('fixture');
  const output = buildStylelintAiRepairInstructions({
    root,
    maxWarnings: 0,
    results: [{
      source: path.join(root, 'stylelint.config.mjs'),
      warnings: [],
      invalidOptionWarnings: [{
        text: 'Invalid option value "wrong" for rule "selector-max-id"',
      }],
    }],
  });

  assert.match(output, /1\./);
  assert.match(output, /invalid-option/);
  assert.match(output, /selector-max-id/);
});

test('gives targeted repairs for repo-owned style complexity rules', () => {
  const root = path.resolve('fixture');
  const output = buildStylelintAiRepairInstructions({
    root,
    maxWarnings: 0,
    results: [{
      source: path.join(root, 'src', 'App.vue'),
      warnings: [{
        line: 10,
        column: 3,
        severity: 'error',
        rule: 'style/max-nesting-depth',
        text: 'Expected nesting depth to be no more than 3',
      }],
    }],
  });

  assert.match(output, /降低样式嵌套深度/);
  assert.match(output, /style\/max-nesting-depth/);
  assert.match(output, /repo-guard style-complexity/);
});

test('gives AI concrete style governance repair guidance', () => {
  const root = path.resolve('fixture');
  const output = buildStylelintAiRepairInstructions({
    root,
    maxWarnings: 0,
    results: [{
      source: path.join(root, 'src', 'components', 'Panel.vue'),
      warnings: [{
        line: 8,
        column: 1,
        severity: 'error',
        rule: 'style/no-unexpected-global-style',
        text: 'unexpected global style',
      }],
    }],
  });

  assert.match(output, /scoped 或 module/);
  assert.match(output, /allowedGlobalStylePatterns/);
  assert.match(output, /不得新增 stylelint-disable/);
  assert.match(output, /repo-guard style-governance/);
});
