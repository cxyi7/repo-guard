import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildManagedTextBlock } from './managed-text-block.js';

export function defineManagedPolicy({ id, file = 'AGENTS.md', buildLines }) {
  if (!/^[a-z][a-z0-9-]*$/.test(id)) {
    throw new TypeError(`托管策略 id 必须使用 kebab-case： ${id}`);
  }
  if (typeof buildLines !== 'function') {
    throw new TypeError(`托管策略 ${id} 必须提供 buildLines 函数`);
  }
  return Object.freeze({
    id,
    file,
    startMarker: `<!-- repo-guard:${id}:start -->`,
    endMarker: `<!-- repo-guard:${id}:end -->`,
    buildLines,
  });
}

function renderManagedPolicy(content, policy, config) {
  return buildManagedTextBlock({
    current: content,
    endMarker: policy.endMarker,
    managedLines: policy.buildLines(config),
    startMarker: policy.startMarker,
    target: policy.file,
  });
}

export function ensureManagedPolicy(root, policy, config) {
  const target = path.join(root, policy.file);
  const existed = existsSync(target);
  const current = existed ? readFileSync(target, 'utf8') : '';
  const next = renderManagedPolicy(current, policy, config);
  if (next === current) return { changed: false, created: false, path: target };
  writeFileSync(target, next, 'utf8');
  return { changed: true, created: !existed, path: target };
}

export function isManagedPolicyPresent(content, policy) {
  return content.includes(policy.startMarker) && content.includes(policy.endMarker);
}

export function isManagedPolicyCurrent(content, policy, config) {
  return isManagedPolicyPresent(content, policy)
    && renderManagedPolicy(content, policy, config) === content;
}
