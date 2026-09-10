import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_EXCEPTIONS_CONFIG, DEFAULT_UI_TOKENS_CONFIG } from '../../src/config/defaults.js';

export const TOKEN_CASES = [
  ['color.brand', 'color', 'color', '#ffffff'],
  ['space.md', 'spacing', 'padding', '12px'],
  ['font.body', 'font-family', 'font-family', 'Arial'],
  ['font.size', 'font-size', 'font-size', '16px'],
  ['font.leading', 'line-height', 'line-height', '1.5'],
  ['font.weight', 'font-weight', 'font-weight', '600'],
  ['radius.md', 'radius', 'border-radius', '8px'],
  ['shadow.card', 'shadow', 'box-shadow', '0 2px 3px black'],
  ['layer.modal', 'z-index', 'z-index', '100'],
  ['breakpoint.tablet', 'breakpoint', 'min-width', '769px'],
  ['duration.fast', 'animation-duration', 'transition-duration', '100ms'],
  ['icon.sm', 'icon-size', 'width', '24px'],
];

export function digest(content) {
  return createHash('sha256').update(content).digest('hex');
}

export function tokenManifest(sourceContent = '{}\n', sourcePath = 'design/tokens.json') {
  return {
    version: 2,
    sources: [{ path: sourcePath, sha256: digest(sourceContent) }],
    tokens: TOKEN_CASES.map(([id, category]) => {
      const name = id.replaceAll('.', '-');
      return { id, category, aliases: {
        css: [category === 'breakpoint' ? '768px' : `var(--${name})`],
        sass: [`$${name}`],
        less: [`@${name}`],
      } };
    }),
  };
}

export function policyConfig(overrides = {}) {
  return {
    ...DEFAULT_UI_TOKENS_CONFIG,
    enabled: true,
    languages: ['css', 'sass', 'less'],
    exceptions: DEFAULT_EXCEPTIONS_CONFIG,
    ...overrides,
  };
}

export function loadedManifest(value = tokenManifest()) {
  return { ...value, sources: value.sources.map((source) => ({
    ...source, actualSha256: source.sha256,
  })) };
}

export function tokenFixture(context) {
  const base = path.resolve(fileURLToPath(new URL('../.tmp', import.meta.url)));
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(path.join(base, 'style-tokens-'));
  context.after(() => {
    assert.ok(path.resolve(root).startsWith(`${base}${path.sep}`));
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(path.join(root, 'src'), { recursive: true });
  mkdirSync(path.join(root, 'design'), { recursive: true });
  return root;
}
