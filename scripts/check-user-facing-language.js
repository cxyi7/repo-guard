import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectEnglishUserFacingText,
  compareLanguageDebt,
} from './user-facing-language.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = path.join(ROOT, 'scripts', 'user-facing-language-baseline.json');
const candidates = collectEnglishUserFacingText(ROOT);

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
const result = compareLanguageDebt(candidates, baseline);

if (result.additions.length > 0) {
  console.error('发现新增的英文或中英混合用户文案。警告、错误、状态和修复说明必须使用中文：');
  for (const addition of result.additions) {
    console.error(`- ${addition.file}:${addition.line} [${addition.context}] ${addition.text}`);
  }
  console.error('请翻译说明性英文；稳定机器标识、命令、路径、包名和第三方规则 ID 保持原值。不要扩大或重新生成历史迁移基线。');
  process.exit(1);
}

if (result.resolvedDebtCount > 0) {
  console.error(
    `已有 ${result.resolvedDebtCount} 条历史英文文案完成中文迁移，但迁移基线尚未安全裁剪。`,
  );
  console.error('请运行 npm run language:prune-baseline，并审查基线只发生删除。');
  process.exit(1);
}

console.log(
  `中文文案硬性检查通过；历史英文债务 ${result.currentDebtCount}/${result.baselineDebtCount}，只允许减少。`,
);
