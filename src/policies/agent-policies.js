import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { configurationError } from '../core/error/repo-guard-error.js';
import {
  buildManagedTextBlocks,
  managedTextIsCurrent,
} from '../core/policy/managed-text-block.js';
import { defineManagedPolicy } from '../core/policy/managed-policy.js';
import {
  agentPolicyGroups,
  renderAgentPolicyGroups,
} from './agent-policy-catalog.js';

export const AGENT_POLICY_FILE = 'AGENTS.md';

const LEGACY_POLICY_IDS = Object.freeze([
  'exception-policy',
  'architecture-policy',
  'unit-test-policy',
  'accessibility-test-policy',
]);

export const agentPolicies = Object.freeze(agentPolicyGroups.map(({ id }) => defineManagedPolicy({
  id,
  file: AGENT_POLICY_FILE,
  buildLines: () => [],
})));

const LEGACY_MARKERS = Object.freeze(LEGACY_POLICY_IDS.map((id) => Object.freeze({
  startMarker: `<!-- repo-guard:${id}:start -->`,
  endMarker: `<!-- repo-guard:${id}:end -->`,
})));

function readPackageJson(root) {
  const target = path.join(root, 'package.json');
  try {
    return JSON.parse(readFileSync(target, 'utf8'));
  } catch (error) {
    throw configurationError(
      'agent-policy/invalid-package-json',
      `无法读取 package.json，不能同步 ${AGENT_POLICY_FILE}: ${error.message}`,
      {
        details: { location: { path: 'package.json' } },
        expected: '项目根目录存在语法有效的 package.json。',
      },
    );
  }
}

function renderedBlocks(config, packageJson) {
  const policiesById = new Map(agentPolicies.map((policy) => [policy.id, policy]));
  return renderAgentPolicyGroups({ config, packageJson }).map(({ id, lines }) => {
    const policy = policiesById.get(id);
    return {
      startMarker: policy.startMarker,
      endMarker: policy.endMarker,
      managedLines: lines,
    };
  });
}

export function renderAgentPolicyDocument(current, config, packageJson = {}) {
  return buildManagedTextBlocks({
    current,
    legacyMarkers: LEGACY_MARKERS,
    blocks: renderedBlocks(config, packageJson),
    target: AGENT_POLICY_FILE,
  });
}

export function inspectAgentPolicies(root, config) {
  const target = path.join(root, AGENT_POLICY_FILE);
  const exists = existsSync(target);
  const current = exists ? readFileSync(target, 'utf8') : '';
  const expected = renderAgentPolicyDocument(current, config, readPackageJson(root));
  return Object.freeze({
    changed: !managedTextIsCurrent(current, expected),
    current,
    exists,
    expected,
    path: target,
  });
}

export function syncAgentPolicies(root, config) {
  const inspection = inspectAgentPolicies(root, config);
  if (!inspection.changed) {
    return Object.freeze({ changed: false, created: false, path: inspection.path });
  }
  writeFileSync(inspection.path, inspection.expected, 'utf8');
  return Object.freeze({
    changed: true,
    created: !inspection.exists,
    path: inspection.path,
  });
}
