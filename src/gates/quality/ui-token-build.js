import { configurationError } from "../../core/error/repo-guard-error.js";
import { DEFAULT_EXCEPTIONS_CONFIG } from "../../config/defaults.js";
import { collectTokenArtifactFacts } from "../../integrations/ui-tokens/artifacts.js";
import { inspectTokenValueDefinitions } from "../../policies/ui-token-values.js";
import { findingFromPolicy, violationResult } from "../native-result.js";
import { uiTokenGate } from "./ui-token-gate.js";

export function tokenArtifactsEnabled(stylelint) {
  return Boolean(
    stylelint?.enabled &&
      stylelint.uiTokens?.enabled &&
      stylelint.uiTokens.artifacts?.enabled,
  );
}

export function validateTokenBuildSetup(build, stylelint) {
  if (!tokenArtifactsEnabled(stylelint)) return;
  if (
    !stylelint.uiTokens.values?.enabled ||
    !stylelint.uiTokens.values.definitions?.length ||
    stylelint.uiTokens.values.definitions.some(
      (entry) => !entry.outputs?.length,
    ) ||
    !build.artifactBudget?.enabled ||
    !build.artifactBudget.cleanScript
  ) {
    throw configurationError(
      "ui-token/incomplete-build-setup",
      "UI Token 产物检查要求开启指定值、为每项定义配置 outputs，并开启 build.artifactBudget 及精确的 cleanScript，确保只检查本轮生成的 CSS。",
    );
  }
}

export async function checkTokenBuildSources({
  root,
  stylelintConfig,
  exceptionsConfig,
}) {
  const config = {
    checks: { stylelint: stylelintConfig },
    repository: { exceptions: exceptionsConfig ?? DEFAULT_EXCEPTIONS_CONFIG },
  };
  const plan = uiTokenGate.plan({
    root,
    config,
    files: [],
    configurationChanged: true,
  });
  return uiTokenGate.run({ root, config, plan });
}

export async function checkTokenBuildArtifacts({
  root,
  config,
  stylelintConfig,
}) {
  const { facts } = await collectTokenArtifactFacts(
    root,
    config,
    stylelintConfig,
  );
  const findings = inspectTokenValueDefinitions(
    stylelintConfig.uiTokens.values.definitions,
    facts,
    { artifact: true },
  );
  return findings.length
    ? violationResult(
        "quality.build",
        `UI Token CSS 产物发现 ${findings.length} 项指定值问题`,
        {
          findings: findings.map((finding) => findingFromPolicy(finding)),
        },
      )
    : null;
}
