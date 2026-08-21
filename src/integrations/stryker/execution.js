import path from 'node:path';
import { runStreamingProcess } from '../../core/execution/streaming-process.js';

export async function executeMutationTest({
  root,
  config,
  setup,
  reports,
  signal = null,
  output = null,
}) {
  return await runStreamingProcess({
    command: process.execPath,
    argumentsList: [
      setup.runnerPath,
      setup.entryPath,
      path.relative(root, setup.configPath),
      path.relative(root, reports.json),
      path.relative(root, reports.originalHtml),
      String(config.originalHtml),
    ],
    root,
    timeoutMs: config.timeoutMs,
    signal,
    output,
  });
}
