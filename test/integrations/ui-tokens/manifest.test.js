import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { DEFAULT_UI_TOKENS_CONFIG } from '../../../src/config/defaults.js';
import { loadUiTokenManifest } from '../../../src/integrations/ui-tokens/manifest.js';
import { inspectUiTokens } from '../../../src/policies/ui-tokens.js';
import { digest, policyConfig, tokenFixture, tokenManifest } from '../../helpers/ui-tokens.js';

function writeManifest(root, value) {
  const file = path.join(root, 'ui-tokens.manifest.json');
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

test('Manifest 读取仅支持 v2，拒绝旧文件时不改写原内容', (context) => {
  const root = tokenFixture(context);
  const source = '{"brand":"#123456"}\r\n';
  writeFileSync(path.join(root, 'design/tokens.json'), source);
  const current = tokenManifest(source);
  const file = writeManifest(root, current);
  const oldContent = `${JSON.stringify({ ...current, version: 1 })}\r\n`;
  writeFileSync(file, oldContent);
  assert.throws(() => loadUiTokenManifest(root, DEFAULT_UI_TOKENS_CONFIG), /仅支持 version: 2/);
  assert.equal(readFileSync(file, 'utf8'), oldContent);

  writeManifest(root, current);
  const loaded = loadUiTokenManifest(root, DEFAULT_UI_TOKENS_CONFIG);
  assert.equal(loaded.version, 2);
  assert.equal(loaded.tokens.length, 12);
  assert.equal(loaded.sources[0].actualSha256, digest(source));
  assert.deepEqual(loaded.tokens[0].aliases, {
    css: ['var(--color-brand)'], sass: ['$color-brand'], less: ['@color-brand'],
  });
});

test('Manifest 读取拒绝来源路径的 glob 与仓库外路径', (context) => {
  const root = tokenFixture(context);
  for (const sourcePath of ['design/*.json', '../tokens.json']) {
    const value = tokenManifest('{}\n', sourcePath);
    writeManifest(root, value);
    assert.throws(() => loadUiTokenManifest(root, DEFAULT_UI_TOKENS_CONFIG), /path/);
  }
});

test('Manifest 不得把自身列为来源文件', (context) => {
  const root = tokenFixture(context);
  writeManifest(root, tokenManifest('{}\n', 'ui-tokens.manifest.json'));
  assert.throws(
    () => loadUiTokenManifest(root, DEFAULT_UI_TOKENS_CONFIG),
    /不得把自身列为来源文件/,
  );
});

test('Manifest 来源指纹失效时产生阻断结果', (context) => {
  const root = tokenFixture(context);
  const source = '{"brand":"#123456"}\n';
  writeFileSync(path.join(root, 'design/tokens.json'), source);
  writeManifest(root, tokenManifest('{"brand":"#ffffff"}\n'));
  const loaded = loadUiTokenManifest(root, DEFAULT_UI_TOKENS_CONFIG);
  const result = inspectUiTokens({ config: policyConfig(), manifest: loaded });
  assert.equal(loaded.sources[0].actualSha256, digest(source));
  assert.deepEqual(result.violations.map(({ rule }) => rule), ['ui-token/stale-manifest']);
});
