import { configurationError } from '../error/repo-guard-error.js';

function normalizeNewlines(content) {
  return String(content).replace(/\r\n?/g, '\n');
}

export function managedTextIsCurrent(current, expected) {
  return normalizeNewlines(current) === normalizeNewlines(expected);
}

function markerIndexes(lines, marker) {
  return lines
    .map((line, index) => (line === marker ? index : -1))
    .filter((index) => index >= 0);
}

function trimLeadingBlankLines(lines) {
  const copy = [...lines];
  while (copy[0] === '') copy.shift();
  return copy;
}

function trimTrailingBlankLines(lines) {
  const copy = [...lines];
  while (copy.at(-1) === '') copy.pop();
  return copy;
}

export function buildManagedTextBlock({
  current,
  endMarker,
  managedLines,
  startMarker,
  target,
}) {
  const normalized = normalizeNewlines(current);
  const lines = normalized.split('\n');
  const starts = markerIndexes(lines, startMarker);
  const ends = markerIndexes(lines, endMarker);

  if (starts.length !== ends.length || starts.length > 1) {
    throw configurationError('managed-text/malformed-markers', `${target} 包含格式错误的 repo-guard 托管标记`, {
      details: { location: { path: target } },
      expected: `${target} 最多只能包含一组顺序正确的托管标记。`,
    });
  }

  const block = [startMarker, ...managedLines, endMarker];
  if (starts.length === 0) {
    const existing = trimTrailingBlankLines(lines);
    return [...existing, ...(existing.length > 0 ? [''] : []), ...block, ''].join('\n');
  }

  if (ends[0] <= starts[0]) {
    throw configurationError('managed-text/malformed-markers', `${target} 包含格式错误的 repo-guard 托管标记`, {
      details: { location: { path: target } },
      expected: `${target} 必须先出现开始标记，再出现与之匹配的结束标记。`,
    });
  }

  const before = trimTrailingBlankLines(lines.slice(0, starts[0]));
  const after = trimLeadingBlankLines(lines.slice(ends[0] + 1));
  const output = [
    ...before,
    ...(before.length > 0 ? [''] : []),
    ...block,
    ...(after.length > 0 ? ['', ...after] : []),
  ];

  return `${trimTrailingBlankLines(output).join('\n')}\n`;
}
