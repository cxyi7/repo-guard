import { writeConsoleMessage } from '../../core/report/console-renderer.js';
import { installHooks } from '../setup/hook-installer.js';

export function runInstallHooks(cwd = process.cwd()) {
  const result = installHooks({
    cwd,
    updatePackageScripts: false,
    allowMissingGit: true,
  });
  if (!result.skipped) {
    writeConsoleMessage(`repo-guard hooks installed in ${result.root}`);
  }
  return 0;
}
