import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runStylelintFiles } from '../../src/gates/quality/stylelint-gate.js';

/** 临时消费项目复用其祖先目录中真实安装的 Stylelint 和语法包。 */
export function styleFixture(t) {
  mkdirSync(path.resolve('test/.tmp'), { recursive: true });
  const root = mkdtempSync(path.resolve('test/.tmp/stylelint-real-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, content) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  };
  write(
    'package.json',
    JSON.stringify({
      name: 'stylelint-consumer',
      version: '1.0.0',
      type: 'module',
    }),
  );
  const options = {
    rules: { 'block-no-empty': true },
    overrides: [
      { files: ['**/*.vue'], customSyntax: 'postcss-html' },
      { files: ['**/*.scss'], customSyntax: 'postcss-scss' },
      { files: ['**/*.less'], customSyntax: 'postcss-less' },
    ],
  };
  return {
    root,
    write,
    options,
    run: (files, settings = {}) =>
      runStylelintFiles({
        root,
        files,
        options,
        governance: {
          enabled: true,
          allowedGlobalStylePatterns: ['styles/**'],
        },
        ...settings,
      }),
  };
}
