/** Java 策略只补充问题语义；标识与指纹仍由公共 GateResult 生成。 */
export function javaEngineeringFinding(
  rule,
  message,
  { file, module, subject, evidence, expected, steps, command },
) {
  const ruleId = `java/${rule}`;
  const identity = [module?.name, subject]
    .filter((value) => value != null)
    .map(encodeURIComponent);
  return {
    ruleId,
    code: [ruleId, ...identity].join("/"),
    severity: "error",
    message,
    location: { path: file },
    evidence: [
      ...(module
        ? [{ type: "java-module", message: `所属模块：${module.name}` }]
        : []),
      ...evidence,
    ],
    expected,
    remediation: {
      goal: expected,
      steps,
      constraints: ["不要通过关闭门禁、缩小必需范围或修改报告来绕过问题。"],
      verification: [`重新运行 repo-guard ${command}，确认本次检查通过。`],
    },
  };
}

export function javaModuleReportPath(module) {
  const report =
    module.reports?.find(
      (item) =>
        typeof item !== "string" && item.cases?.some((entry) => entry.failed),
    ) ?? module.reports?.[0];
  return (
    (typeof report === "string" ? report : report?.path) ??
    module.effectivePom ??
    (module.directory && module.directory !== "."
      ? `${module.directory}/pom.xml`
      : "pom.xml")
  );
}

export function javaTestEvidence(module) {
  const reports = (module.reports ?? []).map((report) => ({
    type: "java-test-report",
    message: `模块 ${module.name} 的本次测试报告`,
    location: { path: typeof report === "string" ? report : report.path },
  }));
  const cases = (module.reports ?? []).flatMap((report) =>
    typeof report === "string"
      ? []
      : (report.cases ?? [])
          .filter((item) => item.failed || item.skipped)
          .map((item) => ({
            type: "java-test-case",
            location: { path: report.path },
            message: `测试类 ${item.classname}，用例 ${item.name}：${item.failed ? "失败" : "跳过"}`,
          })),
  );
  return [
    {
      type: "java-test-count",
      message: `实际执行 ${module.executed} 项，失败 ${module.failed} 项`,
    },
    ...reports,
    ...cases,
  ];
}
