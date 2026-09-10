import { readFileSync } from 'node:fs';
import path from 'node:path';
import { inspectContractContent } from './contract-content.js';
import { inspectContractSchema } from './contract-schema.js';
import { inspectFeatureRegistry } from './feature-registry.js';
import { loadDeliveryContractBundle } from './contract-bundle.js';
import { createDeliveryContractLoader } from './loader.js';
import { commitExists, resolveBranchCommit } from '../../git/delivery-contract-facts.js';
import { hasDeliveryBinding, loadDeliveryWorkspace } from './collaboration.js';

function loadPackageScripts(root, errors) {
  try {
    return JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts ?? {};
  } catch (error) {
    errors.push(`无法读取 package.json 脚本：${error.message}`);
    return {};
  }
}

function validateManagedScripts(root, errors) {
  const scripts = loadPackageScripts(root, errors);
  const expected = new Map([
    ['guard:delivery-contract', 'repo-guard delivery-contract'],
    ['guard:delivery-evidence', 'repo-guard delivery-evidence'],
  ]);
  for (const [name, command] of expected) {
    if (scripts[name] !== command) {
      errors.push(`package.json 脚本 ${name} 必须为 "${command}"；请运行 repo-guard init`);
    }
  }
}

function readRegistry(loader, config, errors) {
  if (!loader.trackedFiles.has(config.registryPath)) {
    errors.push(`功能登记表未受 Git 跟踪：${config.registryPath}`);
    return null;
  }
  try {
    const value = JSON.parse(loader.readText(config.registryPath));
    const inspection = inspectFeatureRegistry(value, config.registryPath, {
      contractsDirectory: config.contractsDirectory,
    });
    errors.push(...inspection.issues.map(({ message }) => message));
    return inspection;
  } catch (error) {
    errors.push(`功能登记表无法解析：${error.message}`);
    return null;
  }
}

function readContracts(loader, config, errors) {
  const contracts = [];
  if (loader.contractPaths.length === 0) {
    errors.push(`合同目录没有受 Git 跟踪的 Markdown 合同：${config.contractsDirectory}`);
    return contracts;
  }
  for (const contractPath of loader.contractPaths) {
    try {
      const bundle = loadDeliveryContractBundle(loader, contractPath);
      errors.push(...bundle.errors);
      const { parsed } = bundle;
      if (!parsed?.data) continue;
      const schema = inspectContractSchema(parsed, config);
      const content = inspectContractContent(parsed);
      errors.push(...schema.issues.map(({ message }) => `${contractPath}：${message}`));
      errors.push(...content.issues.map(({ message }) => `${contractPath}：${message}`));
      contracts.push({ parsed, path: contractPath });
    } catch (error) {
      errors.push(`无法读取交付合同 ${contractPath}：${error.message}`);
    }
  }
  return contracts;
}

function validateBindings(root, registry, contracts, errors) {
  if (!registry) return;
  const branchBindings = new Map();
  const contractsByPath = new Map(contracts.map((contract) => [contract.path, contract]));
  for (const contract of contracts) {
    const data = contract.parsed.data;
    const reference = registry.contracts.get(data.contractId);
    if (!reference || reference.path !== contract.path || reference.featureId !== data.featureId) {
      errors.push(`合同 ${data.contractId} 与功能登记表的路径或功能归属不一致`);
    }
    if (data.lifecycle !== 'active') continue;
    const branch = data.repository?.workingBranch;
    if (branchBindings.has(branch)) {
      errors.push(`活动合同 ${branchBindings.get(branch)} 与 ${data.contractId} 重复绑定分支 ${branch}`);
    } else {
      branchBindings.set(branch, data.contractId);
    }
    if (!commitExists(root, data.repository?.baselineCommit)) {
      errors.push(`活动合同 ${data.contractId} 的 baselineCommit 不存在`);
    }
    if (!resolveBranchCommit(root, data.repository?.targetBranch)) {
      errors.push(`活动合同 ${data.contractId} 的目标分支 ${data.repository?.targetBranch} 无法解析`);
    }
  }
  for (const reference of registry.contracts.values()) {
    if (!contractsByPath.has(reference.path)) {
      errors.push(`功能登记表引用的合同不存在或无法解析：${reference.path}`);
    }
  }
}

export function inspectDeliveryContractSetup({ root, config, environment }) {
  if (hasDeliveryBinding(root)) {
    try {
      loadDeliveryWorkspace(root, { source: environment });
      return { status: 'ready', summary: '独立交付合同绑定与人工确认有效' };
    } catch (error) { return { status: 'incomplete', summary: error.message }; }
  }
  if (environment === 'pre-push') return { status: 'ready', summary: '当前仓库未接入独立交付合同' };
  if (!config.repository.deliveryContract.enabled) {
    return { status: 'ready', summary: '交付合同与交付证据门禁已禁用' };
  }
  const errors = [];
  let loader;
  try {
    loader = createDeliveryContractLoader({
      root,
      environment: 'manual',
      config: config.repository.deliveryContract,
    });
  } catch (error) {
    return { status: 'incomplete', summary: `无法读取交付合同目录：${error.message}` };
  }
  const registry = readRegistry(loader, config.repository.deliveryContract, errors);
  const contracts = readContracts(loader, config.repository.deliveryContract, errors);
  validateBindings(root, registry, contracts, errors);
  validateManagedScripts(root, errors);
  return errors.length === 0
    ? {
      status: 'ready',
      summary: `交付合同设置完整（${contracts.length} 份合同，功能登记、Schema、绑定和脚本均有效）`,
    }
    : {
      status: 'incomplete',
      summary: `交付合同设置不完整：${errors.join('；')}`,
    };
}
