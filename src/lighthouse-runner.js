import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { validateVueLighthouseSetup } from './lighthouse-project.js';

function commandLabel(command, args) {
  return [command, ...args].join(' ');
}

function runProcess(command, args, { root, timeoutMs }) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    timeout: timeoutMs,
    windowsHide: true,
  });

  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') {
      throw new Error(`Command timed out after ${timeoutMs}ms: ${commandLabel(command, args)}`);
    }
    throw new Error(`Unable to run ${commandLabel(command, args)}: ${result.error.message}`);
  }
  return result.status ?? 1;
}

function runNpmScript(root, script, timeoutMs) {
  if (process.platform === 'win32') {
    return runProcess(
      process.env.ComSpec || 'cmd.exe',
      ['/d', '/s', '/c', `npm run ${script}`],
      { root, timeoutMs },
    );
  }
  return runProcess('npm', ['run', script], { root, timeoutMs });
}

function runLhci(root, metadata, configFile, phase, timeoutMs) {
  return runProcess(
    process.execPath,
    [metadata.binPath, phase, `--config=${configFile}`],
    { root, timeoutMs },
  );
}

export function runVueLighthouse({ root, config, skipBuild = false }) {
  const setup = validateVueLighthouseSetup(root, config);
  console.log(
    `repo-guard Lighthouse: Vue project, @lhci/cli ${setup.lighthouse.version}, `
    + `config=${setup.configFile}`,
  );

  if (!skipBuild && config.buildScript) {
    console.log(`repo-guard Lighthouse: running npm script "${config.buildScript}"...`);
    const buildExitCode = runNpmScript(root, config.buildScript, config.timeoutMs);
    if (buildExitCode !== 0) {
      console.error(`repo-guard Lighthouse: build failed with exit code ${buildExitCode}.`);
      return buildExitCode;
    }
  }

  console.log('repo-guard Lighthouse: collecting configured Vue page results...');
  const collectExitCode = runLhci(
    root,
    setup.lighthouse,
    setup.configFile,
    'collect',
    config.timeoutMs,
  );
  if (collectExitCode !== 0) {
    console.error(`repo-guard Lighthouse: collection failed with exit code ${collectExitCode}.`);
    return collectExitCode;
  }

  console.log('repo-guard Lighthouse: checking project assertions...');
  const assertExitCode = runLhci(
    root,
    setup.lighthouse,
    setup.configFile,
    'assert',
    config.timeoutMs,
  );
  if (assertExitCode !== 0) {
    console.error(`repo-guard Lighthouse: assertions failed with exit code ${assertExitCode}.`);
    return assertExitCode;
  }

  console.log(
    `repo-guard Lighthouse passed. Raw reports: ${path.join(root, '.lighthouseci')}`,
  );
  return 0;
}
