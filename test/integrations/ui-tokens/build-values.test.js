import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { styleFixture } from "../../helpers/stylelint.js";
import { DEFAULT_UI_TOKENS_CONFIG } from "../../../src/config/defaults.js";
import { validateExecutionGateConfiguration } from "../../../src/config/execution-gate-validation.js";
import { runBuildGate } from "../../../src/gates/quality/build-gate.js";
import { currentBuildEvidence } from "../../../src/integrations/build-artifacts/evidence.js";
import { buildInputFingerprint, outputFingerprint, recordBuildEvidence, invalidateBuildEvidence } from '../../../src/integrations/build-artifacts/evidence.js';
import { buildGate } from '../../../src/gates/quality/project-quality-gates.js';
import { gateResultToExitCode } from '../../../src/core/result/gate-result.js';

function fixture(t) {
  const f = styleFixture(t);
  assert.equal(
    spawnSync("git", ["init", "--quiet"], { cwd: f.root }).status,
    0,
  );
  f.write(
    ".gitignore",
    "output/\nstyles/tokens.css\nui-tokens.manifest.json\n",
  );
  f.write(
    "package.json",
    JSON.stringify({
      name: "token-build-consumer",
      type: "module",
      scripts: { build: "node build.mjs", clean: "node clean.mjs" },
    }),
  );
  f.write(
    "clean.mjs",
    "import {rmSync} from 'node:fs';rmSync('output',{recursive:true,force:true});",
  );
  const source = ":root { --brand: #ffffff; }";
  const manifest = {
    version: 2,
    sources: [
      {
        path: "styles/tokens.css",
        sha256: createHash("sha256").update(source).digest("hex"),
      },
    ],
    tokens: [
      {
        id: "color.brand",
        category: "color",
        aliases: { css: ["var(--brand)"] },
      },
    ],
  };
  f.write("styles/tokens.css", source);
  f.write("ui-tokens.manifest.json", JSON.stringify(manifest));
  const stylelintConfig = {
    enabled: true,
    options: f.options,
    uiTokens: {
      ...structuredClone(DEFAULT_UI_TOKENS_CONFIG),
      enabled: true,
      values: {
        enabled: true,
        definitions: [
          {
            token: "color.brand",
            source: "styles/tokens.css",
            language: "css",
            alias: "var(--brand)",
            selector: ":root",
            value: "#ffffff",
            outputs: [{ selector: ":root", property: "--brand" }],
          },
        ],
      },
      artifacts: { enabled: true, patterns: ["**/*.css"] },
    },
  };
  const config = validateExecutionGateConfiguration(
    {
      build: {
        enabled: true,
        script: "build",
        timeoutMs: 30000,
        artifactBudget: {
          enabled: true,
          platform: "pc",
          outputDirectory: "output",
          cleanScript: "clean",
          pc: { analyzer: "viteManifest", limits: { totalRawBytes: 10000 } },
        },
      },
    },
    "repo-guard.config.json",
  ).build;
  const build = (css, extra = "") =>
    f.write(
      "build.mjs",
      `import {mkdirSync,writeFileSync} from 'node:fs';
    mkdirSync('output/.vite',{recursive:true});mkdirSync('output/assets',{recursive:true});
    writeFileSync('output/assets/main.js','console.log(1)');writeFileSync('output/assets/main.css',${JSON.stringify(css)});
    writeFileSync('output/.vite/manifest.json',JSON.stringify({entry:{file:'assets/main.js',css:['assets/main.css'],isEntry:true}}));${extra}`,
    );
  build(":root{--brand:#fff}");
  return {
    ...f,
    config,
    stylelintConfig,
    manifest,
    build,
    run: () => runBuildGate({ root: f.root, config, stylelintConfig }),
  };
}

test('真实产物中的大写属性错值不能被后面的正确声明掩盖', async t => {
  const f = fixture(t);
  f.stylelintConfig.uiTokens.values.definitions[0].outputs = [{ selector: '.arbitrary_NAME', property: 'color' }];
  f.build('.arbitrary_NAME/*注释*/{COLOR:#000;color:#fff}');
  const failed = await f.run();
  assert.equal(failed.status, 'violation');
  assert.ok(failed.findings.some(item => item.ruleId === 'ui-token/value-mismatch'));
  f.build('.arbitrary_NAME/*注释*/{COLOR:#fff}');
  assert.equal((await f.run()).status, 'passed');
});

test("真实 npm 构建验证自定义输出目录、压缩值及失败后证据失效", async (t) => {
  const f = fixture(t);
  assert.equal((await f.run()).status, "passed");
  assert.ok(currentBuildEvidence(f.root, f.config, f.stylelintConfig));
  assert.equal(
    currentBuildEvidence(f.root, f.config),
    null,
    "未携带 Token 约定不能复用此证据",
  );
  for (const [css, rule] of [
    [":root{--brand:#000}", "ui-token/value-mismatch"],
    [".unrelated{display:block}", "ui-token/missing-definition"],
    [
      ":root{--brand:#fff}.local{--brand:#fff}",
      "ui-token/unexpected-definition",
    ],
  ]) {
    f.build(css);
    const result = await f.run();
    assert.equal(result.status, "violation", JSON.stringify(result));
    assert.ok(result.findings.some((item) => item.ruleId === rule));
    assert.equal(
      currentBuildEvidence(f.root, f.config, f.stylelintConfig),
      null,
    );
  }
});

test('公共构建门禁保留 Token 配置并使用统一违规退出码', async t => {
  const f = fixture(t);
  f.build(':root{--brand:#000}');
  const result = await buildGate.run({ root: f.root, config: { checks: { build: f.config, stylelint: f.stylelintConfig }, repository: {} }, plan: { enabled: true } });
  assert.equal(result.status, 'violation');
  assert.equal(gateResultToExitCode(result), 2);
  assert.ok(result.findings.some(item => item.ruleId === 'ui-token/value-mismatch'));
});

test('后置校验期间产物被改写不能登记为已通过构建', async t => {
  const f = fixture(t);
  assert.equal((await f.run()).status, 'passed');
  const input = buildInputFingerprint(f.root, f.config, f.stylelintConfig);
  const output = outputFingerprint(f.root, 'output');
  invalidateBuildEvidence(f.root);
  f.write('output/assets/main.css', ':root{--brand:#000}');
  assert.throws(() => recordBuildEvidence(f.root, f.config, input, 'test-run', f.stylelintConfig, output), error => error.code === 'build/outputs-changed');
  assert.equal(currentBuildEvidence(f.root, f.config, f.stylelintConfig), null);
});

test("忽略的 Token 来源变化使构建证据失效，构建中变化拒绝登记成功", async (t) => {
  const f = fixture(t);
  assert.equal((await f.run()).status, "passed");
  f.write("styles/tokens.css", ":root { --brand: #000000; }");
  assert.equal(currentBuildEvidence(f.root, f.config, f.stylelintConfig), null);
  const blocked = await f.run();
  assert.equal(blocked.status, "violation");
  assert.ok(
    blocked.findings.some((item) => item.ruleId === "ui-token/value-mismatch"),
  );
  f.write("styles/tokens.css", ":root { --brand: #ffffff; }");
  f.build(
    ":root{--brand:#fff}",
    "writeFileSync('styles/tokens.css',':root{--brand:#000}');",
  );
  await assert.rejects(f.run, (error) => error.code === "build/inputs-changed");
  assert.equal(currentBuildEvidence(f.root, f.config, f.stylelintConfig), null);
});

test("旧产物不能充当本轮输出，缺失 CSS 与清理配置不能被跳过", async (t) => {
  const f = fixture(t);
  f.config.artifactBudget.cleanScript = null;
  await assert.rejects(f.run, (error) => error.kind === "configuration");
  assert.equal(existsSync(path.join(f.root, "output")), false);
  f.config.artifactBudget.cleanScript = "clean";
  f.stylelintConfig.uiTokens.artifacts.patterns = ["missing/*.css"];
  await assert.rejects(
    f.run,
    (error) => error.code === "ui-token/missing-css-artifacts",
  );
  assert.equal(currentBuildEvidence(f.root, f.config, f.stylelintConfig), null);
  f.stylelintConfig.uiTokens.artifacts.patterns = ["**/*.css"];
  f.write("clean.mjs", "/* 故意不清理，用于验证旧产物拒绝逻辑。 */");
  const result = await f.run();
  assert.equal(result.status, "violation");
  assert.ok(
    result.findings.some(
      (item) => item.ruleId === "build-artifact/stale-output-after-clean",
    ),
  );
});
