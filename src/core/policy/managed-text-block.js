import { configurationError } from '../error/repo-guard-error.js';

function normalizeNewlines(content) {
  return String(content).replace(/\r\n?/g, '\n');
}

export function managedTextIsCurrent(current, expected) {
  return normalizeNewlines(current) === normalizeNewlines(expected);
}

function malformedMarkersError(target, expected) {
  return configurationError(
    'managed-text/malformed-markers',
    `${target} 包含格式错误的 repo-guard 托管标记`,
    {
      details: { location: { path: target } },
      expected,
    },
  );
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

/**
 * 一次性校验、移除并重建一组托管区块。所有标记会先完成校验，调用方因而可以
 * 在确认整个文档有效后只写入一次，避免多策略同步产生部分成功的 AGENTS.md。
 */
export function buildManagedTextBlocks({
  current,
  legacyMarkers = [],
  blocks,
  target,
}) {
  const normalized = normalizeNewlines(current);
  const lines = normalized.split('\n');
  const markers = [
    ...legacyMarkers,
    ...blocks.map(({ startMarker, endMarker }) => ({ startMarker, endMarker })),
  ];
  const ranges = [];

  for (const { startMarker, endMarker } of markers) {
    const starts = markerIndexes(lines, startMarker);
    const ends = markerIndexes(lines, endMarker);
    if (starts.length !== ends.length || starts.length > 1) {
      throw malformedMarkersError(
        target,
        `${target} 中每种托管标记最多只能完整出现一次。`,
      );
    }
    if (starts.length === 0) continue;
    if (ends[0] <= starts[0]) {
      throw malformedMarkersError(
        target,
        `${target} 必须先出现开始标记，再出现与之匹配的结束标记。`,
      );
    }
    ranges.push({ start: starts[0], end: ends[0] });
  }

  ranges.sort((left, right) => left.start - right.start);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index].start <= ranges[index - 1].end) {
      throw malformedMarkersError(target, `${target} 的托管区块不得互相嵌套。`);
    }
  }

  const removedIndexes = new Set();
  for (const { start, end } of ranges) {
    for (let index = start; index <= end; index += 1) removedIndexes.add(index);
  }
  const unmanagedLines = trimTrailingBlankLines(
    lines.filter((_, index) => !removedIndexes.has(index)),
  );
  const managedBlocks = blocks.map(({ startMarker, endMarker, managedLines }) => [
    startMarker,
    ...managedLines,
    endMarker,
  ]);
  const output = [
    ...unmanagedLines,
    ...(unmanagedLines.length > 0 && managedBlocks.length > 0 ? [''] : []),
    ...managedBlocks.flatMap((block, index) => (
      index === managedBlocks.length - 1 ? block : [...block, '']
    )),
  ];
  return `${trimTrailingBlankLines(output).join('\n')}\n`;
}
