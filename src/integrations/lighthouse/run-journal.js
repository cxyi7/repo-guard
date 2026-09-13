import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveBuildArtifactOutput } from '../build-artifacts/project.js';

/** 每次执行独立保存已脱敏的门禁诊断，重跑不覆盖失败证据。 */
export function saveLighthouseRun(root, result, startedAt) {
  const relative = `reports/lighthouse-runs/${startedAt}-${randomUUID()}/result.json`;
  const target = resolveBuildArtifactOutput(root, { outputDirectory: relative }).outputDirectory;
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify({ version: 2, startedAt, finishedAt: Date.now(), result }, null, 2)}\n`, { flag: 'wx' });
  return { ...result, artifacts: [...result.artifacts, { path: relative, type: 'lighthouse-run', description: '本次 Lighthouse 独立执行诊断（第三方输出已脱敏并受长度限制）' }] };
}
