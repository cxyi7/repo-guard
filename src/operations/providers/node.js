import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { EXIT_CODES } from '../../core/result/exit-code.js';

export function validateNodeReleaseScripts(repositoryRoot, project, unit) {
  const projectRoot = path.resolve(repositoryRoot, project.root);
  let manifest;
  try {
    const relative = path.relative(realpathSync(repositoryRoot), realpathSync(projectRoot));
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw configurationError('operations/project-outside-root', `项目 ${project.id} 的实际目录必须位于仓库内`);
    }
    manifest = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  } catch (cause) {
    throw configurationError('operations/project-manifest', `项目 ${project.id} 的目录或 package.json 无法读取`, { cause });
  }
  const requiredScripts = [unit.buildScript, ...Object.values(unit.environments).map((environment) => environment.script)];
  const missing = requiredScripts.filter((script) => typeof manifest.scripts?.[script] !== 'string'
    || !manifest.scripts[script].trim());
  if (missing.length) {
    throw configurationError('operations/missing-script', `项目 ${project.id} 未声明脚本：${[...new Set(missing)].join('、')}`);
  }
}

export function nodeReleaseCommand(script) {
  return `npm run ${script}`;
}

export function nodeArtifactVerificationProgram() {
  return [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    `function fail(message) { fs.writeSync(2, message + '\\n'); process.exit(${EXIT_CODES.error}); }`,
    'function count(file) {',
    'const stat = fs.lstatSync(file);',
    "if (stat.isSymbolicLink()) fail('构建产物不得使用符号链接：' + file);",
    'if (stat.isFile()) return 1;',
    "if (!stat.isDirectory()) fail('构建产物必须是文件或目录：' + file);",
    'return fs.readdirSync(file).reduce((total, item) => total + count(path.join(file, item)), 0);',
    '}',
    'for (const file of process.argv.slice(1)) {',
    "let current = '.';",
    "for (const segment of file.split('/')) {",
    'current = path.join(current, segment);',
    "if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) fail('构建产物路径不得经过符号链接：' + current);",
    '}',
    "if (!fs.existsSync(file) || count(file) === 0) fail('构建产物缺失或为空：' + file);",
    '}',
  ].join(' ');
}

export function nodeArtifactVerificationCommand(artifactPaths) {
  const program = nodeArtifactVerificationProgram();
  const quotedProgram = `'${program.replaceAll("'", "'\"'\"'")}'`;
  return `node --input-type=commonjs -e ${quotedProgram} ${artifactPaths.join(' ')}`;
}
