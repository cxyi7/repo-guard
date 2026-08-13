const STREAM_BY_LEVEL = Object.freeze({
  log: 'stdout',
  info: 'stdout',
  warn: 'stderr',
  error: 'stderr',
});

export function renderGateResultConsole(result, { label = result.gateId } = {}) {
  const lines = result.diagnostics.map((diagnostic) => ({
    stream: STREAM_BY_LEVEL[diagnostic.level],
    message: diagnostic.message,
  }));
  if (result.status === 'skipped') {
    lines.push({ stream: 'stdout', message: `SKIP  ${label}` });
  } else if (result.status === 'passed') {
    lines.push({ stream: 'stdout', message: `PASS  ${label}` });
  } else if (result.status === 'violation') {
    lines.push({ stream: 'stderr', message: `FAIL  ${label}` });
  } else {
    lines.push({
      stream: 'stderr',
      message: `ERROR ${label}: ${result.error?.message ?? result.summary}`,
    });
  }
  return lines;
}

export function writeGateResultConsole(result, options) {
  for (const line of renderGateResultConsole(result, options)) {
    if (line.stream === 'stderr') console.error(line.message);
    else console.log(line.message);
  }
}
