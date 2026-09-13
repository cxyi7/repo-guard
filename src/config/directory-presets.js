import { DIRECTORY_BINDING_TARGETS, directoryFieldValue, resolveDirectoryPaths } from './directory-roles.js';
import { directoryEntries } from '../profiles/directory-presets.js';

/** 从现有预设的路径字段生成引用；不改动用户原生工具配置。 */
export function createDirectoryPreset(document) {
  const entries = directoryEntries(document.project);
  const paths = resolveDirectoryPaths({ entries });
  // 相同路径保留基础职责，避免 packages 与 source 重复引用。
  const seen = new Set();
  const replacements = Object.entries(paths).filter(([, value]) => {
    if (seen.has(value)) return false;
    seen.add(value); return true;
  }).sort((a, b) => b[1].length - a[1].length);
  const replace = (value) => {
    if (typeof value === 'string') {
      value = value.replace(/src\/\(\?:([a-z|]+)\)/g, (original, alternatives) => {
        const ids = alternatives.split('|');
        return ids.every((id) => Object.hasOwn(entries, id)) ? `(?:${ids.map((id) => `\${${id}}`).join('|')})` : original;
      });
      for (const [id, actual] of replacements) {
        const escaped = actual.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        value = value.replace(new RegExp(`(^|[!^/{,(|])${escaped}(?=/|$|[,})|])`, 'g'), (_, prefix) => `${prefix}\${${id}}`);
      }
      return value;
    }
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]));
    return value;
  };
  const bindings = {};
  for (const target of DIRECTORY_BINDING_TARGETS) {
    const [, check, field] = target.split('.');
    const value = directoryFieldValue(document, target);
    if (value === undefined) continue;
    const template = replace(value);
    if (!JSON.stringify(template).includes('${')) continue;
    bindings[target] = { format: check === 'architecture' && ['rules', 'exclude'].includes(field) ? 'regex' : 'glob', value: template };
  }
  if (document.project.stack === 'java') {
    for (const check of ['javaFormat', 'javaNaming', 'javaLayout', 'javaImports', 'javaSize', 'javaDocs', 'javaLint', 'javaDuplication']) {
      bindings[`checks.${check}.include`] = { format: 'glob', value: ['**/${source}/**/*.java', '**/${tests}/**/*.java'] };
    }
  } else if (document.project.role === 'frontend') {
    const rules = bindings['checks.maxFileLines.rules'].value;
    rules[1].pattern = '{${composables},${utils}}/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}';
    rules[2].pattern = '{${api},${stores},${store}}/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}';
    bindings['checks.asyncResourceCleanup.include'] = { format: 'glob', value: [
      '${source}/**/*.vue', '${composables}/**/*.{js,jsx,ts,tsx,mjs,cjs}',
    ] };
  } else {
    bindings['checks.unitTest.testPatterns'] = { format: 'glob', value: ['${tests}/**/*.{spec,test}.{js,mjs,cjs,ts,mts,cts}'] };
    bindings['checks.unitTest.mappings'] = { format: 'glob', value: [{
      sourcePattern: '${source}/**/*.{js,mjs,cjs,ts,mts,cts}', sourceRoot: '${source}',
      testTemplates: ['${tests}/{relativePath}.test.{ext}', '${tests}/{relativePath}.spec.{ext}'],
    }] };
  }
  return { entries, bindings };
}
