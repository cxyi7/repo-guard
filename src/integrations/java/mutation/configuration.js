import path from 'node:path';
import { configurationError } from '../../../core/error/repo-guard-error.js';
import { isPitExternalProperty } from './properties.js';

export function evaluatePitConfiguration(effective, config, module, root) {
  const reject = (message) => { throw configurationError('java/pit-configuration', `模块 ${module.name} 的 PIT 配置不可用：${message}`); };
  if (!effective.configured || effective.version !== config.pluginVersion) reject('必须在构建插件中声明与 pluginVersion 一致的 PIT 版本');
  if (effective.unsupportedMerging || effective.duplicateFields || effective.executions.length) reject('本轮不接受 PIT 执行区块、重复字段或自定义合并控制，请在插件公共配置中设置工具参数');
  const injected = Object.keys(effective.properties ?? {}).find(isPitExternalProperty);
  if (injected) reject(`有效 POM 的 properties 包含工具属性 ${injected}，请移除隐藏注入并在受控插件配置中声明`);
  const values = effective.configuration;
  const allowedFields = new Set([
    'parseSurefireConfig', 'skip', 'skipTests', 'dryRun', 'withHistory',
    'skipFailingTests', 'crossModule', 'fullMutationMatrix', 'timestampedReports',
    'mutationThreshold', 'coverageThreshold', 'testStrengthThreshold', 'maxSurviving',
    'failWhenNoMutations', 'outputFormats', 'targetClasses', 'targetTests',
    'reportsDirectory', 'mutationEngine', 'threads', 'timeoutFactor', 'timeoutConstant',
  ]);
  const unsupported = Object.keys(values).find((field) => !allowedFields.has(field));
  if (unsupported) reject(`不支持配置字段 ${unsupported}；本轮只允许受控执行参数，不接受缩减检查范围的扩展配置`);
  if (values.parseSurefireConfig !== 'false') reject('必须显式设置 parseSurefireConfig=false，避免导入忽略失败的测试配置');
  for (const field of ['skip', 'skipTests', 'dryRun', 'withHistory', 'skipFailingTests', 'crossModule', 'fullMutationMatrix', 'timestampedReports']) {
    if (values[field] !== undefined && values[field] !== 'false') reject(`${field} 不得开启`);
  }
  for (const [field, minimum, maximum, integer] of [['threads', 1, 256, true], ['timeoutFactor', 0.01, 100, false], ['timeoutConstant', 0, 2147483647, true]]) {
    if (values[field] !== undefined && (typeof values[field] !== 'string' || !/^\d+(?:\.\d+)?$/.test(values[field]) || !Number.isFinite(Number(values[field])) || Number(values[field]) < minimum || Number(values[field]) > maximum || (integer && !Number.isInteger(Number(values[field]))))) reject(`${field} 必须在支持的执行资源范围内`);
  }
  for (const field of ['mutationThreshold', 'coverageThreshold', 'testStrengthThreshold']) {
    if (values[field] !== undefined && values[field] !== '0') reject(`${field} 应留空或设为 0，阈值统一由 repo-guard 计算`);
  }
  if (values.failWhenNoMutations !== undefined && values.failWhenNoMutations !== 'true') reject('failWhenNoMutations 不得关闭');
  if (values.maxSurviving !== undefined && values.maxSurviving !== '-1') reject('maxSurviving 应留空或设为 -1，阈值统一由 repo-guard 计算');
  if (values.outputFormats !== undefined && JSON.stringify(values.outputFormats) !== JSON.stringify(['XML'])) reject('outputFormats 只能为 XML');
  for (const field of ['targetClasses', 'targetTests']) {
    if (values[field] !== undefined && JSON.stringify(values[field]) !== JSON.stringify(module[field])) reject(`${field} 必须与当前模块声明完全一致`);
  }
  if (values.reportsDirectory !== undefined && (typeof values.reportsDirectory !== 'string' || path.resolve(root, module.directory, values.reportsDirectory) !== path.resolve(root, path.posix.dirname(module.mutationReport)))) reject('reportsDirectory 必须与 mutationReport 所在目录一致');
  if (values.mutationEngine !== undefined && values.mutationEngine !== 'gregor') reject('本轮仅支持 PIT 原生 gregor 变异引擎');
}
