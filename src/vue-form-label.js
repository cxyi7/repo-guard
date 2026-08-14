import { readFileSync } from 'node:fs';
import path from 'node:path';
import { findStructuredException } from './exception-registry.js';
import {
  findVueTemplateElements,
  sourceLocation,
} from './vue-template-parser.js';

export const VUE_FORM_CONTROL_LABEL_RULE = 'vue/form-control-label';
const FORM_CONTROLS = new Set(['input', 'select', 'textarea']);
const NON_TEXT_INPUT_TYPES = new Set(['button', 'hidden', 'image', 'reset', 'submit']);

function isBinding(name, attribute) {
  return name === `:${attribute}`
    || name === `v-bind:${attribute}`
    || name.startsWith(`:${attribute}.`)
    || name.startsWith(`v-bind:${attribute}.`);
}

function expressionLiteral(value) {
  const text = value?.trim();
  if (!text || text.length < 2) return null;
  const quote = text[0];
  if ((quote !== '"' && quote !== "'" && quote !== '`') || text.at(-1) !== quote) {
    return null;
  }
  return text.slice(1, -1);
}

function resolvedAttribute(element, name) {
  const attribute = element.attributes.find((candidate) => (
    candidate.name === name || isBinding(candidate.name, name)
  ));
  if (!attribute) return null;
  if (attribute.name === name) {
    return { attribute, kind: 'static', value: attribute.value };
  }
  const value = expressionLiteral(attribute.value);
  return value == null
    ? { attribute, kind: 'dynamic', value: null }
    : { attribute, kind: 'bound-literal', value };
}

function normalizedValue(resolved) {
  return resolved?.value?.trim() || null;
}

function isLabelRequired(element) {
  if (!FORM_CONTROLS.has(element.name)) return false;
  if (element.name !== 'input') return true;
  const type = normalizedValue(resolvedAttribute(element, 'type'))?.toLowerCase() || 'text';
  return !NON_TEXT_INPUT_TYPES.has(type);
}

function wrappingLabel(element, elementsByStart) {
  let parent = elementsByStart.get(element.parentStart);
  while (parent) {
    if (parent.name === 'label') return parent;
    parent = elementsByStart.get(parent.parentStart);
  }
  return null;
}

function hasTextContent(source, element) {
  const content = source.slice(element.end, element.contentEnd)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, '')
    .trim();
  return content.length > 0;
}

function invalidStatus(code, message, remediation) {
  return { code, message, remediation, valid: false };
}

function accessibleNameStatus(source, element, labelsByFor, ids, elementsByStart) {
  const parentLabel = wrappingLabel(element, elementsByStart);
  if (parentLabel && hasTextContent(source, parentLabel)) return { valid: true };

  const ariaLabel = resolvedAttribute(element, 'aria-label');
  if (normalizedValue(ariaLabel)) return { valid: true };
  if (ariaLabel?.kind === 'dynamic') {
    return invalidStatus(
      'dynamic-aria-label',
      'aria-label 使用动态表达式，门禁无法证明它在所有状态下都能生成非空且有意义的控件名称',
      '优先改为可见 <label>；确实需要 aria-label 时，改为非空静态文本或可静态解析的绑定字面量，例如 :aria-label="\'搜索\'"',
    );
  }
  if (ariaLabel) {
    return invalidStatus(
      'empty-aria-label',
      '控件声明了 aria-label，但值为空或只有空白字符，不能形成有效的无障碍名称',
      '填写能够准确描述控件用途的非空 aria-label；如果页面已有可见字段名称，优先使用 <label for="..."> 与控件 id 关联',
    );
  }

  const labelledBy = resolvedAttribute(element, 'aria-labelledby');
  const labelledByValue = normalizedValue(labelledBy);
  if (labelledByValue) {
    const references = labelledByValue.split(/\s+/).filter(Boolean);
    const missing = references.filter((reference) => !ids.has(reference));
    const selfReferences = references.filter((reference) => (
      ids.get(reference)?.start === element.start
    ));
    const empty = references.filter((reference) => {
      const target = ids.get(reference);
      return target && target.start !== element.start && !hasTextContent(source, target);
    });
    if (missing.length === 0 && selfReferences.length === 0 && empty.length === 0) {
      return { valid: true };
    }
    const problems = [
      missing.length > 0 ? `不存在的 id：${missing.join(', ')}` : '',
      empty.length > 0 ? `没有可读文本的 id：${empty.join(', ')}` : '',
      selfReferences.length > 0 ? `控件自引用的 id：${selfReferences.join(', ')}` : '',
    ].filter(Boolean).join('；');
    return invalidStatus(
      'invalid-aria-labelledby',
      `aria-labelledby 无法形成有效的无障碍名称（${problems}）`,
      '修正 aria-labelledby，使每个 token 都指向模板内一个具有明确可读文本的其他元素；删除无效或自引用 token。若只有一个简单名称，优先改用可见 <label> 或非空 aria-label',
    );
  }
  if (labelledBy?.kind === 'dynamic') {
    return invalidStatus(
      'dynamic-aria-labelledby',
      'aria-labelledby 使用动态表达式，门禁无法确认它始终指向存在且包含可读文本的元素',
      '改用静态 id 列表，并确保每个 id 对应的元素存在且具有可读文本；或使用静态 for/id 的可见 <label>',
    );
  }
  if (labelledBy) {
    return invalidStatus(
      'empty-aria-labelledby',
      '控件声明了 aria-labelledby，但值为空或只有空白字符，未引用任何命名元素',
      '填写实际命名元素的静态 id；如果没有可复用的命名元素，改用可见 <label> 或非空 aria-label',
    );
  }

  if (parentLabel) {
    return invalidStatus(
      'empty-wrapping-label',
      '控件虽然被 <label> 包裹，但该 label 没有可读文本，且控件没有其他有效无障碍名称，屏幕阅读器无法识别其用途',
      '在外层 <label> 中补充准确描述控件用途的可见文本；如果设计上不能显示文本，则移除空 label，并在控件上添加非空静态 aria-label',
    );
  }

  const resolvedId = resolvedAttribute(element, 'id');
  const id = normalizedValue(resolvedId);
  if (id && labelsByFor.get(id)?.hasText) return { valid: true };
  if (id && labelsByFor.has(id)) {
    return invalidStatus(
      'empty-explicit-label',
      `控件 id="${id}" 已被 <label for="${id}"> 关联，但该 label 没有可读文本`,
      `在 <label for="${id}"> 中补充准确描述该控件用途的可见文本，并保留现有 for/id 关联`,
    );
  }
  if (id) {
    return invalidStatus(
      'unassociated-control-id',
      `控件具有 id="${id}"，但模板中没有 <label for="${id}"> 与它关联`,
      `添加包含准确可见文本的 <label for="${id}">，并保留控件 id="${id}"；也可以用包含文本的 <label> 直接包裹控件`,
    );
  }
  if (resolvedId?.kind === 'dynamic') {
    return invalidStatus(
      'dynamic-control-id',
      '控件 id 使用动态表达式，模板中无法静态证明存在匹配的 label[for] 关联',
      '改用稳定的静态 id 与 <label for="..."> 配对，或使用包含可见文本的 <label> 直接包裹控件',
    );
  }
  return invalidStatus(
    'missing-accessible-name',
    '控件没有关联的可见 <label>，也没有非空 aria-label 或有效 aria-labelledby，因此屏幕阅读器无法识别其用途',
    '优先添加可见 <label>：使用静态 for/id 配对或直接包裹控件；确实没有可见字段名时，再添加描述用途的非空静态 aria-label',
  );
}

export function findVueFormLabelIssues(source, relativePath = 'component.vue') {
  const elements = findVueTemplateElements(source);
  const elementsByStart = new Map(elements.map((element) => [element.start, element]));
  const ids = new Map();
  const labelsByFor = new Map();

  for (const element of elements) {
    const id = normalizedValue(resolvedAttribute(element, 'id'));
    if (id && !ids.has(id)) ids.set(id, element);
    if (element.name === 'label') {
      const htmlFor = normalizedValue(resolvedAttribute(element, 'for'));
      if (htmlFor) {
        const current = labelsByFor.get(htmlFor);
        labelsByFor.set(htmlFor, {
          hasText: Boolean(current?.hasText || hasTextContent(source, element)),
        });
      }
    }
  }

  return elements
    .filter(isLabelRequired)
    .flatMap((element) => {
      const status = accessibleNameStatus(
        source,
        element,
        labelsByFor,
        ids,
        elementsByStart,
      );
      if (status.valid) return [];
      return [{
        ...sourceLocation(source, element.start + 1),
        offset: element.start + 1,
        path: relativePath,
        issue: status.code,
        message: status.message,
        remediation: status.remediation,
        rule: VUE_FORM_CONTROL_LABEL_RULE,
        tagName: element.name,
      }];
    });
}

function normalizeFiles(root, files) {
  return files.map((file) => {
    if (typeof file !== 'string') return file;
    const absolute = path.resolve(root, file);
    return {
      absolute,
      relative: path.relative(root, absolute).replace(/\\/g, '/'),
    };
  });
}

export function inspectVueFormLabels({ root, files, exceptions }) {
  const approved = [];
  const violations = [];
  let checkedCount = 0;
  for (const file of normalizeFiles(root, files)) {
    if (!file.relative.toLowerCase().endsWith('.vue')) continue;
    checkedCount += 1;
    const source = readFileSync(file.absolute, 'utf8');
    for (const finding of findVueFormLabelIssues(source, file.relative)) {
      const exception = findStructuredException(exceptions, finding);
      if (exception) approved.push({ ...finding, exception });
      else violations.push(finding);
    }
  }
  return { approved, checkedCount, violations };
}
