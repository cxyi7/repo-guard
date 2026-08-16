import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { defineGate } from '../core/capability/gate-definition.js';

const CONFIG_VERSION = [1];

export function readyGateSetup(summary) {
  return { status: 'ready', summary };
}

export function policyFileIsCurrent(root, file, predicate, config) {
  const target = path.join(root, file);
  return existsSync(target) && predicate(readFileSync(target, 'utf8'), config);
}

export function definePlatformGate(definition) {
  return defineGate({
    configVersions: CONFIG_VERSION,
    mutation: 'read-only',
    allowedMutations: ['read-only'],
    defaultTimeoutMs: 120000,
    inspectSetup: () => null,
    ...definition,
  });
}
