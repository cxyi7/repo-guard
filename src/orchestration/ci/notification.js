import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  validateCiNotification,
  CI_NOTIFICATION_TEST_REPORT,
} from "../../config/ci-notification.js";
import { sendCiNotifications } from "../../gates/release/ci-notification.js";
import {
  writeConsoleMessage,
  writeGateResultConsole,
} from "../../core/report/console-renderer.js";
import { EXIT_CODES } from "../../core/result/exit-code.js";
import { gitValue } from "../../git/execution.js";
import { findRepositoryRoot } from "../../git/repository.js";
import { writeCiReport } from "./report.js";

export { CI_NOTIFICATION_TEST_REPORT } from "../../config/ci-notification.js";

/** 独立读取通知配置，其他检查配置错误时仍尽可能发送失败结论。 */
export function prepareCiNotification(root) {
  try {
    const document = JSON.parse(
      readFileSync(path.join(root, "repo-guard.config.json"), "utf8"),
    );
    const config = validateCiNotification(document.ci?.notification);
    const name = document.project?.id ?? path.basename(root);
    if (!config.enabled) return null;
    if (!config.channels.length) {
      writeConsoleMessage(
        "CI 通知默认开启，但尚未配置渠道。请填写 ci.notification.channels 并运行 repo-guard ci-notification-test，或明确设置 ci.notification.enabled 为 false。",
      );
      return null;
    }
    return { config, name };
  } catch {
    writeConsoleMessage(
      "无法读取有效的 CI 通知配置。请检查仓库中的 ci.notification；未读取环境变量凭据。",
    );
    return null;
  }
}

function safeText(value, notification) {
  let text = String(value ?? "未知");
  for (const channel of notification.config.channels) {
    for (const secret of [channel.webhook, channel.secret].filter(Boolean))
      text = text.replaceAll(secret, "[已隐藏]");
  }
  return [...text]
    .map((character) => (character.codePointAt(0) < 32 ? " " : character))
    .join("")
    .slice(0, 160);
}

/** GitLab 按提交检出时使用平台上下文；标签不冒充普通分支。 */
function revisionContext(root, env) {
  if (env.GITLAB_CI === "true") {
    const source = env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME?.trim();
    if (source) return { label: "分支", value: source };
    const tag = env.CI_COMMIT_TAG?.trim();
    if (tag) return { label: "标签", value: tag };
    const branch = env.CI_COMMIT_BRANCH?.trim();
    if (branch) return { label: "分支", value: branch };
    const ref = env.CI_COMMIT_REF_NAME?.trim();
    if (ref) return { label: "引用", value: ref };
  }
  const branch = gitValue(["branch", "--show-current"], "", root);
  return branch
    ? { label: "分支", value: branch }
    : { label: "检出方式", value: "指定提交检出（未附着分支）" };
}

export async function notifyCiOutcome(
  root,
  notification,
  exitCode,
  report,
  { test = false, send, env = process.env } = {},
) {
  if (!notification) return EXIT_CODES.error;
  const ref = revisionContext(root, env);
  const head = report?.head ?? gitValue(["rev-parse", "HEAD"], "未知", root);
  const failures = (
    report?.targets
      ? report.targets.flatMap(({ report: target }) => [
          ...(target.steps ?? []),
          ...(target.gateResult ? [{ gateResult: target.gateResult }] : []),
        ])
      : (report?.steps ?? [])
  )
    .filter(
      ({ gateResult }) =>
        gateResult && !["passed", "skipped"].includes(gateResult.status),
    )
    .map(({ gateResult }) => gateResult.gateId);
  const content = [
    test
      ? "repo-guard CI 通知接入测试：请确认群内收到此消息。"
      : `repo-guard CI ${exitCode === EXIT_CODES.success ? "检查成功" : "检查失败"}`,
    `项目：${safeText(notification.name, notification)}`,
    `${ref.label}：${safeText(ref.value, notification)}`,
    `目标提交：${safeText(head, notification)}`,
    ...(failures.length
      ? [
          `失败检查：${safeText([...new Set(failures)].slice(0, 8).join("、"), notification)}`,
        ]
      : []),
    ...(report?.gateResult
      ? [`失败原因：${safeText(report.gateResult.summary, notification)}`]
      : []),
    "详细结果请查看本次终端输出及仓库内 CI 报告。",
  ].join("\n");
  const result = await sendCiNotifications(notification.config, content, {
    send,
  });
  result.results.forEach((item) => writeGateResultConsole(item));
  return result.exitCode;
}

export async function runCiNotificationTest(cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const notification = prepareCiNotification(root);
  return testCiNotification(root, notification, { force: true });
}

/** 接入测试按当前配置缓存一天；换机器、修改配置或主动测试时真实发送。 */
export async function testCiNotification(
  root,
  notification,
  { force = false, send, now = Date.now() } = {},
) {
  if (!notification) return EXIT_CODES.error;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(notification.config))
    .digest("hex");
  if (!force) {
    try {
      const receipt = JSON.parse(
        readFileSync(path.join(root, CI_NOTIFICATION_TEST_REPORT), "utf8"),
      );
      if (
        receipt.version === 2 &&
        receipt.status === "passed" &&
        receipt.fingerprint === fingerprint &&
        Number.isFinite(receipt.checkedAt) &&
        receipt.checkedAt <= now &&
        now - receipt.checkedAt < 86400000
      )
        return EXIT_CODES.success;
    } catch {
      /* 首次接入、缓存无效或缺失时重新测试。 */
    }
  }
  const exitCode = await notifyCiOutcome(
    root,
    notification,
    EXIT_CODES.success,
    null,
    { test: true, send },
  );
  try {
    writeCiReport(root, CI_NOTIFICATION_TEST_REPORT, {
      version: 2,
      status: exitCode === EXIT_CODES.success ? "passed" : "failed",
      fingerprint,
      checkedAt: now,
    });
  } catch {
    writeConsoleMessage(
      "通知测试结果无法保存；下次运行会重新测试，不会覆盖受跟踪文件。",
    );
  }
  return exitCode;
}
