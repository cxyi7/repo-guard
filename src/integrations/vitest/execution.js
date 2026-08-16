import { runProjectScript } from '../npm/run-script.js';
import { buildCoverageArguments } from './coverage.js';

export async function executeUnitTests({
  root,
  config,
  signal = null,
  output = null,
}) {
  const coverageArgs = buildCoverageArguments(config);
  return await runProjectScript({
    root,
    script: config.script,
    timeoutMs: config.timeoutMs,
    extraArguments: coverageArgs,
    signal,
    output,
  });
}
