import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { validateConfig } from '../src/config/configuration-validation.js';
import { codePlacementGate } from '../src/gates/repository/code-placement-gate.js';
import {
  inspectCodePlacement,
  selectCodePlacementFiles,
} from '../src/policies/code-placement.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
mkdirSync(TEST_ROOT, { recursive: true });

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function codePlacementConfig() {
  return {
    enabled: true,
    rules: [{
      name: '支付签名',
      content: 'const signature = createPaymentSignature(payload);',
      allowedFiles: [
        'src/payment/signature.ts',
        'src/admin/payment-signature.ts',
      ],
      scanPatterns: ['src/**/*.ts'],
    }],
  };
}

function projectConfig() {
  return validateConfig({
    version: 1,
    codePlacement: codePlacementConfig(),
    rules: [{ pattern: '**', category: '测试文件', level: 'audit' }],
    exclusions: [],
  });
}

test('reports exact code outside every allowed file with its line', () => {
  const config = codePlacementConfig();
  const files = [
    {
      path: 'src/payment/signature.ts',
      content: 'const signature = createPaymentSignature(payload);\n',
    },
    {
      path: 'src/admin/payment-signature.ts',
      content: 'const signature = createPaymentSignature(payload);\r\n',
    },
    {
      path: 'src/orders/submit.ts',
      content: 'export function submit() {\n  const signature = createPaymentSignature(payload);\n}\n',
    },
    {
      path: 'docs/example.md',
      content: 'const signature = createPaymentSignature(payload);\n',
    },
  ];

  assert.deepEqual(
    selectCodePlacementFiles(files.map(({ path: filePath }) => filePath), config),
    [
      'src/payment/signature.ts',
      'src/admin/payment-signature.ts',
      'src/orders/submit.ts',
    ],
  );
  const result = inspectCodePlacement({ files, config });
  assert.equal(result.checkedCount, 4);
  assert.deepEqual(
    result.violations.map(({ line, path: filePath }) => ({ line, path: filePath })),
    [{ line: 2, path: 'src/orders/submit.ts' }],
  );
});

test('pre-commit checks the final index and ignores unstaged duplicate code', (context) => {
  const root = mkdtempSync(path.join(TEST_ROOT, 'code-placement-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, ['init']);
  mkdirSync(path.join(root, 'src', 'payment'), { recursive: true });
  mkdirSync(path.join(root, 'src', 'orders'), { recursive: true });
  writeFileSync(
    path.join(root, 'src', 'payment', 'signature.ts'),
    'const signature = createPaymentSignature(payload);\n',
  );
  writeFileSync(path.join(root, 'src', 'orders', 'submit.ts'), 'export const submit = true;\n');
  git(root, ['add', '.']);

  writeFileSync(
    path.join(root, 'src', 'orders', 'submit.ts'),
    'const signature = createPaymentSignature(payload);\n',
  );
  const gateContext = {
    root,
    environment: 'pre-commit',
    config: projectConfig(),
    files: [],
  };
  const unstagedPlan = codePlacementGate.plan(gateContext);
  assert.equal(codePlacementGate.run({ config: gateContext.config, plan: unstagedPlan }).status, 'passed');

  git(root, ['add', 'src/orders/submit.ts']);
  const stagedPlan = codePlacementGate.plan(gateContext);
  const result = codePlacementGate.run({ config: gateContext.config, plan: stagedPlan });
  assert.equal(result.status, 'violation');
  assert.equal(result.findings[0].location.path, 'src/orders/submit.ts');
  assert.match(result.findings[0].message, /只允许放在指定文件/);
});
