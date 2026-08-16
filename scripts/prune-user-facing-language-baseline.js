import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectEnglishUserFacingText,
  pruneLanguageDebtBaseline,
} from './user-facing-language.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = path.join(ROOT, 'scripts', 'user-facing-language-baseline.json');
const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
const pruned = pruneLanguageDebtBaseline(collectEnglishUserFacingText(ROOT), baseline);

writeFileSync(BASELINE_PATH, `${JSON.stringify(pruned, null, 2)}\n`, 'utf8');
console.log(`中文文案迁移基线已安全裁剪到 ${pruned.debtCount} 条历史英文文案。`);
