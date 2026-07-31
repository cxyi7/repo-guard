function markerIndexes(lines, marker) {
  return lines
    .map((line, index) => (line === marker ? index : -1))
    .filter((index) => index >= 0);
}

function trimLeadingBlankLines(lines) {
  const copy = [...lines];
  while (copy[0] === '') {
    copy.shift();
  }
  return copy;
}

function trimTrailingBlankLines(lines) {
  const copy = [...lines];
  while (copy.at(-1) === '') {
    copy.pop();
  }
  return copy;
}

export function buildManagedTextBlock({
  current,
  endMarker,
  managedLines,
  startMarker,
  target,
}) {
  const normalized = current.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const starts = markerIndexes(lines, startMarker);
  const ends = markerIndexes(lines, endMarker);

  if (starts.length !== ends.length || starts.length > 1) {
    throw new Error(`${target} contains malformed repo-guard managed markers`);
  }

  const block = [startMarker, ...managedLines, endMarker];
  if (starts.length === 0) {
    const existing = trimTrailingBlankLines(
      lines.filter((line) => !managedLines.includes(line.trim())),
    );
    return [...existing, ...(existing.length > 0 ? [''] : []), ...block, ''].join('\n');
  }

  if (ends[0] <= starts[0]) {
    throw new Error(`${target} contains malformed repo-guard managed markers`);
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
