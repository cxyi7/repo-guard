import micromatch from 'micromatch';
/** 根据解析事实约束隔离与全局位置，不推断运行时视觉冲突。 */
export function inspectStyleGovernanceFacts({
  relative,
  blocks,
  escapes,
  allowedPatterns,
}) {
  if (micromatch.isMatch(relative, allowedPatterns, { dot: true })) return [];
  const violation = (location, text) => ({
    ...location,
    severity: 'error',
    rule: 'no-unexpected-global-style',
    text,
  });
  const findings =
    blocks === null
      ? /\.module\.(css|scss|sass|less)$/i.test(relative)
        ? []
        : [
            violation(
              { line: 1, column: 1 },
              '全局样式文件必须位于配置允许的目录，或使用 CSS Module。',
            ),
          ]
      : blocks
          .filter((block) => !block.isolated)
          .map((block) =>
            violation(
              { line: block.line, column: block.column },
              'Vue style 块必须使用 scoped 或 module，或位于批准的全局样式文件。',
            ),
          );
  return [
    ...findings,
    ...escapes.map((location) =>
      violation(
        location,
        '全局选择器会绕过样式隔离，只能在批准的全局样式文件使用。',
      ),
    ),
  ];
}
