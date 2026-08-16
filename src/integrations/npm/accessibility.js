import { runProjectScript } from './run-script.js';

export async function executeAccessibilityTests({
  root,
  config,
  signal = null,
  output = null,
}) {
  return await runProjectScript({
    root,
    script: config.script,
    timeoutMs: config.timeoutMs,
    signal,
    output,
  });
}
