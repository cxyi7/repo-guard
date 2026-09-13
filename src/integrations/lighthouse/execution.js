import { runStreamingProcess } from '../../core/execution/streaming-process.js';
import { runProjectScript } from '../npm/run-script.js';

export function runLighthouseBuild(root, script, timeoutMs, signal = null) {
  return runProjectScript({ root, script, timeoutMs, signal });
}

export function runLighthousePhase(root, metadata, configFile, phase, timeoutMs, signal = null) {
  return runStreamingProcess({ command: process.execPath,
    argumentsList: [metadata.binPath, phase, `--config=${configFile}`], root, timeoutMs, signal });
}
