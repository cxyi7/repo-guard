import { collectProjectFiles } from './file-placement.js';
import {
  buildDynamicCodeGateResult,
  findDynamicCodeExecution,
  inspectDynamicCode,
  NO_EVAL_RULE,
  NO_FUNCTION_CONSTRUCTOR_RULE,
} from './gates/security/dynamic-code-gate.js';
import {
  buildDynamicCodeAiInstructions,
  renderDynamicCodeResult as renderDynamicCodeLines,
} from './gates/security/dynamic-code-renderer.js';

export {
  buildDynamicCodeAiInstructions,
  findDynamicCodeExecution,
  inspectDynamicCode,
  NO_EVAL_RULE,
  NO_FUNCTION_CONSTRUCTOR_RULE,
};

export function renderDynamicCodeResult(result) {
  for (const line of renderDynamicCodeLines(result)) {
    if (line.stream === 'stderr') console.error(line.message);
    else console.log(line.message);
  }
  if (result.status === 'execution-error') {
    throw Object.assign(new Error(result.error.message), { code: result.error.code });
  }
  return result.status === 'violation' ? 1 : 0;
}

export function runDynamicCodeFiles({ root, files, exceptions }) {
  return renderDynamicCodeResult(buildDynamicCodeGateResult({ root, files, exceptions }));
}

export function runDynamicCodeProject({ root, exceptions }) {
  return runDynamicCodeFiles({ root, files: collectProjectFiles(root), exceptions });
}
