import { parseDocument } from 'yaml';

const CHECKBOX = /^\s*- \[([ xX])\] `([^`]+)`\s+(.+?)\s*$/;
const DETAIL = /^\s{2,}- ([^：:]+)[：:]\s*(.*?)\s*$/;
const FINDING_HEADING = /^###\s+`(FND-[A-Z0-9-]+)`\s+(.+?)\s*$/;

function stripCode(value) {
  const trimmed = value.trim();
  return trimmed.startsWith('`') && trimmed.endsWith('`')
    ? trimmed.slice(1, -1).trim()
    : trimmed;
}

function splitFrontmatter(source) {
  const normalized = source.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  if (lines[0] !== '---') {
    return { body: normalized, errors: ['文件必须以 YAML Frontmatter 的 --- 开始'], frontmatter: null };
  }
  const end = lines.indexOf('---', 1);
  if (end < 0) {
    return { body: '', errors: ['YAML Frontmatter 缺少结束的 ---'], frontmatter: null };
  }
  return {
    body: lines.slice(end + 1).join('\n'),
    errors: [],
    frontmatter: lines.slice(1, end).join('\n'),
  };
}

export function parseMarkdownFrontmatter(source) {
  const split = splitFrontmatter(source);
  if (split.frontmatter == null) return { ...split, data: null };
  const document = parseDocument(split.frontmatter, {
    merge: false,
    schema: 'core',
    uniqueKeys: true,
  });
  const errors = [
    ...split.errors,
    ...document.errors.map(({ message }) => `YAML Frontmatter 无法解析：${message}`),
  ];
  let data = null;
  if (errors.length === 0) {
    try {
      data = document.toJS({ maxAliasCount: 0 });
    } catch (error) {
      errors.push(`YAML Frontmatter 无法转换为安全对象：${error.message}`);
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    errors.push('YAML Frontmatter 必须解析为对象');
    data = null;
  }
  return { ...split, data, errors };
}

function visibleLines(source) {
  let fenced = false;
  return source.split('\n').map((line) => {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      return '';
    }
    return fenced ? '' : line;
  });
}

function parseSections(body) {
  const lines = visibleLines(body);
  const sections = new Map();
  let current = null;
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = heading[1];
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    if (current) sections.get(current).push(line);
  }
  return sections;
}

function parseChecklist(lines) {
  const items = [];
  let current = null;
  for (const line of lines) {
    const checkbox = line.match(CHECKBOX);
    if (checkbox) {
      current = {
        checked: checkbox[1].toLowerCase() === 'x',
        details: {},
        id: checkbox[2].trim(),
        summary: checkbox[3].trim(),
      };
      items.push(current);
      continue;
    }
    if (!current) continue;
    const detail = line.match(DETAIL);
    if (!detail) continue;
    const key = detail[1].trim();
    const value = stripCode(detail[2]);
    current.details[key] = current.details[key]
      ? `${current.details[key]}, ${value}`
      : value;
  }
  return items;
}

function parseFindings(lines) {
  const findings = [];
  let current = null;
  for (const line of lines) {
    const heading = line.match(FINDING_HEADING);
    if (heading) {
      current = {
        id: heading[1],
        summary: heading[2],
        details: {},
        checklistLines: [],
      };
      findings.push(current);
      continue;
    }
    if (!current) continue;
    current.checklistLines.push(line);
    const detail = line.match(/^\s*- ([^：:]+)[：:]\s*(.*?)\s*$/);
    if (detail) current.details[detail[1].trim()] = stripCode(detail[2]);
  }
  return findings.map(({ checklistLines, ...finding }) => ({
    ...finding,
    checklist: parseChecklist(checklistLines),
  }));
}

export function parseDeliveryContractMarkdown(source) {
  const frontmatter = parseMarkdownFrontmatter(source);
  const sections = parseSections(frontmatter.body);
  const obligations = parseChecklist(sections.get('交付执行清单') ?? []);
  const findings = parseFindings(sections.get('交付发现') ?? []);
  return {
    body: frontmatter.body,
    data: frontmatter.data,
    errors: frontmatter.errors,
    findings,
    obligations,
    sections,
  };
}

export function sectionHasContent(parsed, name) {
  return (parsed.sections.get(name) ?? []).some((line) => line.trim() !== '');
}
