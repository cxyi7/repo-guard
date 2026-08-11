const DAY_MS = 24 * 60 * 60 * 1000;

function utcDay(value) {
  return Date.parse(`${value}T00:00:00.000Z`) / DAY_MS;
}

function todayText(now) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Exception inspection requires a valid current date');
  }
  return date.toISOString().slice(0, 10);
}

export function inspectExceptionRegistry(config, { now = new Date() } = {}) {
  const today = todayText(now);
  const todayDay = utcDay(today);
  const entries = config.entries.map((entry) => {
    const createdDay = utcDay(entry.createdOn);
    const daysRemaining = utcDay(entry.expiresOn) - todayDay;
    const status = createdDay > todayDay
      ? 'future'
      : daysRemaining < 0
      ? 'expired'
      : daysRemaining <= config.warningDays ? 'expiring' : 'active';
    return { ...entry, daysRemaining, status };
  });
  return {
    active: entries.filter(({ status }) => status === 'active'),
    entries,
    expired: entries.filter(({ status }) => status === 'expired'),
    expiring: entries.filter(({ status }) => status === 'expiring'),
    future: entries.filter(({ status }) => status === 'future'),
    today,
  };
}

export function formatExceptionRegistryReport(result) {
  const lines = [
    `repo-guard structured exceptions: ${result.entries.length} total, `
      + `${result.active.length} active, ${result.expiring.length} expiring, `
      + `${result.expired.length} expired, ${result.future.length} future-dated `
      + `(today=${result.today}).`,
  ];
  for (const entry of result.entries) {
    const remaining = entry.daysRemaining < 0
      ? `${Math.abs(entry.daysRemaining)} day(s) overdue`
      : `${entry.daysRemaining} day(s) remaining`;
    lines.push(
      `- [${entry.status}] ${entry.id}: ${entry.rule} at `
      + `${entry.path}:${entry.line}:${entry.column}; expires ${entry.expiresOn} `
      + `(${remaining}); owner=${entry.owner}; approvedBy=${entry.approvedBy}; `
      + `ticket=${entry.ticket}`,
    );
  }
  return lines.join('\n');
}

export function assertExceptionRegistryCurrent(config, options) {
  const result = inspectExceptionRegistry(config, options);
  if (result.expired.length === 0 && result.future.length === 0) return result;
  throw new Error([
    formatExceptionRegistryReport(result),
    'Expired exceptions must be removed with the violation fixed or renewed through human review; future-dated entries are invalid.',
    'AI must not extend dates, change locations, or alter approval metadata to bypass the gate.',
  ].join('\n'));
}

export function findStructuredException(config, finding, options) {
  const result = inspectExceptionRegistry(config, options);
  const normalizedPath = String(finding.path).replace(/\\/g, '/').replace(/^\.\//, '');
  return result.entries.find((entry) => (
    (entry.status === 'active' || entry.status === 'expiring')
    && entry.rule === finding.rule
    && entry.path === normalizedPath
    && entry.line === finding.line
    && entry.column === finding.column
  )) ?? null;
}
