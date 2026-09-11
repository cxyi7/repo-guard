import { JAVA_SOURCE_DEFAULTS } from '../../config/java-source.js';
import { createJavaTool, javaToolKind } from '../../integrations/java/source/tool.js';
import { JAVA_SOURCE_FEATURES } from '../../policies/java/source-rules.js';
import { definePlatformGate, readyGateSetup } from '../platform-gate.js';
import { skippedResult } from '../native-result.js';
import { runJavaSourceGate } from './source-runner.js';

function createSourceGate(descriptor, index) {
  const { feature, id, command, label } = descriptor;
  const format = feature === 'javaFormat';
  const environments = ['manual', 'pre-push', 'ci-full', 'release-ready'];
  return definePlatformGate({
    id, configKey: `checks.${feature}`, featureName: feature,
    featureOrder: 400 + index * 10, doctorOrder: 400 + index * 10,
    manualCommand: command, manualOrder: 400 + index * 10,
    manualOptions: format ? ['--fix'] : [], packageScript: `guard:${command}`,
    environments: feature === 'javaDuplication' ? environments : ['pre-commit', ...environments],
    mutation: format ? 'working-tree-fix' : 'read-only',
    allowedMutations: format ? ['working-tree-fix', 'read-only'] : ['read-only'],
    supportsFix: format, supportsCancellation: true,
    defaultTimeoutMs: JAVA_SOURCE_DEFAULTS[feature].timeoutMs,
    requiredTools: [javaToolKind(feature)],
    async inspectSetup({ root, config, signal }) {
      const settings = config.checks[feature];
      if (!settings.enabled) return readyGateSetup(`${label}检查已禁用`);
      const version = await createJavaTool({ root, feature, config: settings, signal }).inspectVersion();
      return readyGateSetup(`${label}检查工具已准备（${javaToolKind(feature)} ${version}）`);
    },
    plan: ({ config, files = [], environment, javaFix = false, argumentsList = [], configurationChanged = false }) => ({
      enabled: config.checks[feature].enabled,
      files: files.map((file) => typeof file === 'string' ? file : file.absolute ?? file.relative),
      fix: format && ((environment === 'pre-commit' && javaFix === true)
        || (environment === 'manual' && argumentsList.includes('--fix'))),
      configurationChanged,
    }),
    run: ({ root, config, plan, signal, environment }) => plan.enabled
      ? runJavaSourceGate({
          root, feature, config: config.checks[feature], files: plan.files,
          fix: plan.fix, signal, environment, configurationChanged: plan.configurationChanged,
        })
      : skippedResult(id, `${label}检查已禁用`),
  });
}

export const javaSourceGates = Object.freeze(JAVA_SOURCE_FEATURES.map(createSourceGate));
