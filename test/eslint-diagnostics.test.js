import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { buildEslintAiRepairInstructions } from '../src/eslint-diagnostics.js';

test('builds one numbered AI repair instruction for each ESLint problem', () => {
  const root = path.resolve('fixture');
  const output = buildEslintAiRepairInstructions({
    root,
    maxWarnings: 0,
    results: [
      {
        filePath: path.join(root, 'src', 'views', 'user', 'index.vue'),
        errorCount: 2,
        warningCount: 0,
        messages: [
          {
            column: 12,
            line: 36,
            message: "'userList' is not defined.",
            ruleId: 'no-undef',
            severity: 2,
          },
          {
            column: 7,
            line: 48,
            message: 'Parsing error: Unexpected token =',
            ruleId: null,
            severity: 2,
          },
        ],
      },
    ],
  });

  assert.match(
    output,
    /1\. 请修复 src\/views\/user\/index\.vue 第 36 行第 12 列的 ESLint 问题。/,
  );
  assert.match(output, /规则：no-undef/);
  assert.match(output, /请判断变量应该被声明、导入还是名称写错。/);
  assert.match(
    output,
    /2\. 请修复 src\/views\/user\/index\.vue 第 48 行第 7 列的 ESLint 问题。/,
  );
  assert.match(output, /规则：parsing-error/);
  assert.match(output, /不要关闭 ESLint 规则，不要修改无关文件。/);
  assert.match(output, /修复后重新执行暂存和提交。/);
});
