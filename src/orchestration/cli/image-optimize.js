import { writeConsoleMessage } from '../../core/report/console-renderer.js';
import { executeImageOptimization } from '../../gates/repository/image-assets-optimizer.js';
import { loadExecutionTarget } from '../workspace/project-selection.js';

export async function runImageOptimize(options) {
  const { root, config } = loadExecutionTarget(options.cwd, { projectId: options.projectId });
  const messages = await executeImageOptimization({ ...options, root, config });
  for (const message of messages) writeConsoleMessage(message);
  return 0;
}
