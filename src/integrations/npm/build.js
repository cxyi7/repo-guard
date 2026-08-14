import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { runProjectScript } from './run-script.js';

function readProjectPackage(root) {
  const target = path.join(root, 'package.json');
  if (!existsSync(target)) {
    throw configurationError(
      'build/missing-package-json',
      'package.json was not found in repository root',
    );
  }
  return JSON.parse(readFileSync(target, 'utf8'));
}

export function validateBuildSetup(root, config) {
  const packageJson = readProjectPackage(root);
  const command = packageJson.scripts?.[config.script];
  if (typeof command !== 'string' || !command.trim()) {
    throw configurationError(
      'build/missing-script',
      `Build gate requires package.json script "${config.script}"`,
    );
  }
  return { command: command.trim() };
}

export function executeProjectBuild({ root, config }) {
  const setup = validateBuildSetup(root, config);
  const execution = runProjectScript({
    root,
    script: config.script,
    timeoutMs: config.timeoutMs,
  });
  return Object.freeze({ setup, execution });
}
