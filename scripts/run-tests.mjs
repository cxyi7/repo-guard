import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { constants } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const TEST_SUITES = Object.freeze([
  'core', 'config', 'profiles', 'policies', 'gates',
  'integrations', 'setup', 'provisioning', 'hooks', 'ci', 'operations',
  'e2e', 'architecture', 'docs',
]);
const GATE_SUITES = ['repository', 'quality', 'testing', 'security', 'release'];
const EXCLUDED_DIRECTORIES = new Set(['fixtures', 'helpers', 'node_modules']);

/** 只接受已登记的测试组；Node 测试参数保持独立参数传递。 */
export function parseTestArguments(argumentsList) {
  const suites = [];
  const nodeArguments = [];
  let list = false;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--list') {
      list = true;
    } else if (argument === '--suite' || argument.startsWith('--suite=')) {
      const value = argument === '--suite' ? argumentsList[++index] : argument.slice(8);
      if (!value || value.startsWith('--')) throw new TypeError('--suite 必须指定测试组。');
      suites.push(...value.split(','));
    } else if (/^--test-[a-z-]+(?:=.*)?$/.test(argument)) {
      nodeArguments.push(argument);
      if (!argument.includes('=') && argumentsList[index + 1] && !argumentsList[index + 1].startsWith('--')) {
        nodeArguments.push(argumentsList[++index]);
      }
      if (argument.startsWith('--test-concurrency')) {
        const value = argument.includes('=') ? argument.split('=')[1] : nodeArguments.at(-1);
        if (!/^[1-9]\d*$/.test(value)) throw new TypeError('--test-concurrency 必须是正整数。');
      }
    } else {
      throw new TypeError(`不支持的测试参数：${argument}。请使用 --suite 或 Node --test-* 参数。`);
    }
  }
  const selectedSuites = [...new Set(suites.length ? suites : TEST_SUITES)];
  for (const suite of selectedSuites) {
    if (!TEST_SUITES.includes(suite) && !GATE_SUITES.some((name) => suite === `gates/${name}`)) {
      throw new TypeError(`未知测试组：${suite}。可选：${TEST_SUITES.join('、')}，或 gates 下的具体功能组。`);
    }
  }
  return { suites: selectedSuites, nodeArguments, list, explicitSuites: suites.length > 0 };
}

function collectDirectoryTests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.') || EXCLUDED_DIRECTORIES.has(entry.name) || entry.isSymbolicLink()) return [];
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectDirectoryTests(target);
    return entry.isFile() && entry.name.endsWith('.test.js') ? [target] : [];
  });
}

/** 排除样例、辅助文件和生成目录，不依赖各平台 shell 的通配符行为。 */
export function collectTestFiles(repositoryRoot, options) {
  const files = options.suites.flatMap((suite) => {
    const directory = path.join(repositoryRoot, 'test', suite);
    const matches = existsSync(directory) ? collectDirectoryTests(directory) : [];
    if (options.explicitSuites && matches.length === 0) throw new TypeError(`测试组 ${suite} 中没有找到 *.test.js 文件。`);
    return matches;
  });
  const uniqueFiles = [...new Set(files)].sort();
  if (uniqueFiles.length === 0) throw new TypeError('没有找到可执行的测试，请检查 test 目录和测试组配置。');
  return uniqueFiles;
}

/** 使用仓库根目录执行，保证测试定位与调用者所在目录无关。 */
export function runTests(argumentsList, { repositoryRoot = REPOSITORY_ROOT, spawn = spawnSync } = {}) {
  const options = parseTestArguments(argumentsList);
  const files = collectTestFiles(repositoryRoot, options);
  if (options.list) {
    process.stdout.write(`${files.map((file) => path.relative(repositoryRoot, file).replaceAll('\\', '/')).join('\n')}\n`);
    return 0;
  }
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  const result = spawn(process.execPath, ['--test', ...options.nodeArguments, ...files], {
    cwd: repositoryRoot,
    env: environment,
    shell: false,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw new TypeError(`无法启动测试：${result.error.message}`, { cause: result.error });
  return result.status ?? (result.signal ? 128 + (constants.signals[result.signal] ?? 1) : 1);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    process.exitCode = runTests(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`测试执行失败：${error.message}\n`);
    process.exitCode = 1;
  }
}
