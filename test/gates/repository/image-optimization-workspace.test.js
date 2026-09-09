import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { executeImageOptimization } from '../../../src/gates/repository/image-assets-optimizer.js';
import { loadWorkspace } from '../../../src/config/configuration-loader.js';
import { createGitProjectFixture } from '../../helpers/git-project.js';

const CLI_PATH = fileURLToPath(new URL('../../../bin/repo-guard.js', import.meta.url));
const IMAGE_PATH = 'src/assets/logo.svg';
const image = (color) => `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">${' '.repeat(1000)}<rect width="100" height="100" fill="${color}" /></svg>\n`;

function workspaceFixture(t) {
  const files = {
    'repo-guard.config.json': JSON.stringify({ version: 2, projects: [
      { id: 'web', root: 'apps/web', config: 'configuration/quality.json' },
      { id: 'api', root: 'apps/api', config: 'configuration/quality.json' },
    ] }),
  };
  for (const [id, role, preset] of [['web', 'frontend', 'vue-javascript'], ['api', 'backend', 'node-javascript']]) {
    files[`apps/${id}/configuration/quality.json`] = JSON.stringify({
      version: 2,
      project: { id, role, stack: 'node', preset },
      checks: { imageAssets: {
        enabled: true,
        include: ['src/assets/**/*.svg'],
        exclude: [],
        compression: {
          enabled: true,
          minInputBytes: 0,
          minSavingsBytes: 1,
          minSavingsPercent: 1,
          svg: { enabled: true, allowWrite: true },
        },
      } },
    });
    files[`apps/${id}/package.json`] = JSON.stringify({ name: id, version: '1.0.0', devDependencies: { svgo: '4.1.0' } });
    files[`apps/${id}/${IMAGE_PATH}`] = image(id === 'web' ? 'red' : 'green');
  }
  const root = createGitProjectFixture(t, files);
  const toolsDirectory = fileURLToPath(new URL('../../../node_modules', import.meta.url));
  for (const id of ['web', 'api']) {
    symlinkSync(toolsDirectory, path.join(root, 'apps', id, 'node_modules'), 'junction');
  }
  return root;
}

function cli(root, args) {
  return spawnSync(process.execPath, [CLI_PATH, 'image-optimize', ...args], { cwd: root, encoding: 'utf8', windowsHide: true });
}

test('真实命令按项目选择和自定义配置优化图片，保留另一应用的同名文件', (t) => {
  const root = workspaceFixture(t);
  const webImage = path.join(root, 'apps/web', IMAGE_PATH);
  const apiImage = path.join(root, 'apps/api', IMAGE_PATH);
  const webBefore = readFileSync(webImage);
  const apiBefore = readFileSync(apiImage);
  const ambiguous = cli(root, ['--', IMAGE_PATH]);
  assert.notEqual(ambiguous.status, 0);
  assert.match(ambiguous.stdout + ambiguous.stderr, /--project/);
  const preview = cli(root, ['--project', 'web', '--', IMAGE_PATH]);
  assert.equal(preview.status, 0, preview.stdout + preview.stderr);
  assert.deepEqual(readFileSync(webImage), webBefore);
  const write = cli(root, ['--project', 'web', '--write', '--', IMAGE_PATH]);
  assert.equal(write.status, 0, write.stdout + write.stderr);
  assert.ok(readFileSync(webImage).length < webBefore.length);
  assert.deepEqual(readFileSync(apiImage), apiBefore);
  assert.match(write.stdout, /src\/assets\/logo.svg/);
});

test('图片路径不能逃离所选应用，且可以从应用目录读取登记的自定义配置', (t) => {
  const root = workspaceFixture(t);
  const escaped = cli(root, ['--project', 'web', '--write', '--', `../api/${IMAGE_PATH}`]);
  assert.notEqual(escaped.status, 0);
  assert.match(escaped.stdout + escaped.stderr, /图片路径必须位于所选应用目录内/);
  const unknown = cli(root, ['--project', 'missing', '--', IMAGE_PATH]);
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stdout + unknown.stderr, /未配置项目/);
  const fromApp = cli(path.join(root, 'apps/web'), ['--', IMAGE_PATH]);
  assert.equal(fromApp.status, 0, fromApp.stdout + fromApp.stderr);
});

test('优化执行器接受编排层已解析的配置，不尝试重新读取默认子配置文件', async (t) => {
  const root = workspaceFixture(t);
  const application = loadWorkspace(root).projects.find(({ id }) => id === 'api');
  const messages = await executeImageOptimization({ root: application.root, config: application.config, paths: [IMAGE_PATH] });
  assert.ok(messages.some((message) => message.includes('src/assets/logo.svg')));
  assert.equal(readFileSync(path.join(root, 'apps/web', IMAGE_PATH), 'utf8'), image('red'));
});
