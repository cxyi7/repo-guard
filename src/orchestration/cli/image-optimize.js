import { writeConsoleMessage } from '../../core/report/console-renderer.js';
import { executeImageOptimization } from '../../gates/repository/image-assets-optimizer.js';

export async function runImageOptimize(options) {
  const messages = await executeImageOptimization(options);
  for (const message of messages) writeConsoleMessage(message);
  return 0;
}
