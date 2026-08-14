export function renderExceptionRegistrySummary(result) {
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
