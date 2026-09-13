import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { executionError } from '../../core/error/repo-guard-error.js';
import { runGit } from '../../git/execution.js';
import { loadUiTokenManifest } from '../ui-tokens/manifest.js';

const builds = new Map();
const hash = (value) => createHash('sha256').update(value).digest('hex');

function hashFiles(root, names) {
  const digest = createHash('sha256');
  let bytes = 0;
  if (names.length > 100000)
    throw executionError(
      'build/fingerprint-file-limit',
      '构建指纹文件数量超过安全上限 100000，请检查项目输出与忽略配置。',
    );
  for (const name of [...new Set(names)].sort()) {
    const target = path.resolve(root, name);
    if (!existsSync(target)) {
      digest.update(`${name}\0缺失\0`);
      continue;
    }
    const stat = lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw executionError(
        'build/non-regular-input',
        `构建指纹只接受普通文件：${name}`,
      );
    bytes += stat.size;
    if (stat.size > 268435456 || bytes > 1073741824)
      throw executionError(
        'build/fingerprint-byte-limit',
        '构建指纹超过单文件 256 MiB 或总计 1 GiB 的安全上限，请检查产物和忽略配置。',
      );
    digest.update(`${name}\0`).update(readFileSync(target)).update('\0');
  }
  return digest.digest('hex');
}

export function buildInputFingerprint(root, config, stylelintConfig = null) {
  const output = config.artifactBudget?.outputDirectory;
  const names = runGit(
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root },
  )
    .stdout.split('\0')
    .filter(Boolean)
    .filter(
      (name) =>
        !name
          .split('/')
          .some((part) => ['node_modules', '.git'].includes(part)) &&
        !['.lighthouseci/', 'reports/', '.stryker-tmp/'].some((prefix) =>
          name.startsWith(prefix),
        ),
    )
    .filter(
      (name) => !output || (name !== output && !name.startsWith(`${output}/`)),
    );
  const tokenContract = stylelintConfig?.enabled && stylelintConfig.uiTokens?.enabled && stylelintConfig.uiTokens.artifacts?.enabled
    ? { config: stylelintConfig, manifest: loadUiTokenManifest(root, stylelintConfig.uiTokens) } : null;
  return hash(JSON.stringify({ files: hashFiles(root, names), config, tokenContract }));
}

export function outputFingerprint(root, directory) {
  if (!directory || !existsSync(path.resolve(root, directory))) return null;
  const names = [];
  const collect = (relative) => {
    for (const entry of readdirSync(path.resolve(root, relative), {
      withFileTypes: true,
    })) {
      const name = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink())
        throw executionError(
          'build/symlink-artifact',
          `产物包含符号链接：${name}`,
        );
      if (entry.isDirectory()) collect(name);
      else names.push(name);
    }
  };
  collect(directory);
  return hashFiles(root, names);
}

export function invalidateBuildEvidence(root) {
  builds.delete(path.resolve(root));
}

export function recordBuildEvidence(root, config, before, runId, stylelintConfig = null, checkedOutput = undefined) {
  const input = buildInputFingerprint(root, config, stylelintConfig);
  if (input !== before)
    throw executionError(
      'build/inputs-changed',
      '构建过程中源码或配置发生变化，请重新构建。',
    );
  const output = outputFingerprint(root, config.artifactBudget?.outputDirectory);
  if (checkedOutput !== undefined && output !== checkedOutput) throw executionError('build/outputs-changed', '构建后检查期间产物发生变化，请重新构建。');
  const evidence = {
    version: 1,
    runId,
    script: config.script,
    input,
    output,
  };
  builds.set(path.resolve(root), evidence);
  return evidence;
}

export function currentBuildEvidence(root, config, stylelintConfig = null) {
  const evidence = builds.get(path.resolve(root));
  if (!evidence?.output) return null;
  return evidence.input === buildInputFingerprint(root, config, stylelintConfig) &&
    evidence.output ===
      outputFingerprint(root, config.artifactBudget?.outputDirectory)
    ? evidence
    : null;
}
