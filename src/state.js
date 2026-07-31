import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveGitPath } from './git.js';

function readJson(target) {
  if (!existsSync(target)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(target, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(target, value) {
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function notificationWasSent(root, fingerprint) {
  const state = readJson(resolveGitPath(root, 'repo-guard-notified.json'));
  return state?.fingerprint === fingerprint;
}

export function saveNotificationState(root, fingerprint) {
  writeJson(resolveGitPath(root, 'repo-guard-notified.json'), {
    fingerprint,
    notifiedAt: new Date().toISOString(),
  });
}

export function readCommitMessageState(root) {
  return readJson(resolveGitPath(root, 'repo-guard-commit-message.json'));
}

export function saveCommitMessageState(root, state) {
  writeJson(resolveGitPath(root, 'repo-guard-commit-message.json'), state);
}

export function clearCommitMessageState(root) {
  rmSync(resolveGitPath(root, 'repo-guard-commit-message.json'), { force: true });
}
