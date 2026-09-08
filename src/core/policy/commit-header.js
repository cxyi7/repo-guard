const CONVENTIONAL_HEADER = /^([a-z][a-z0-9-]*)(?:\(([a-z0-9][a-z0-9._/@-]*)\))?(!)?: (.+)$/u;

// 校验与展示共享标题语法；允许哪些类型仍由项目的提交信息策略决定。
export function matchConventionalHeader(header) {
  return CONVENTIONAL_HEADER.exec(header);
}
