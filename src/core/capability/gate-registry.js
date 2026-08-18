import { internalError } from '../error/repo-guard-error.js';

function validateRegistry(gates) {
  const ids = new Set();
  const commands = new Set();
  const configKeys = new Set();
  const featureNames = new Set();
  for (const gate of gates) {
    if (ids.has(gate.id)) throw internalError('capability/invalid-registry', `门禁 id 重复： ${gate.id}`);
    ids.add(gate.id);
    if (gate.configKey) {
      if (configKeys.has(gate.configKey)) {
        throw internalError('capability/invalid-registry', `门禁配置键重复： ${gate.configKey}`);
      }
      configKeys.add(gate.configKey);
    }
    if (gate.featureName) {
      if (featureNames.has(gate.featureName)) {
        throw internalError('capability/invalid-registry', `门禁功能名称重复： ${gate.featureName}`);
      }
      featureNames.add(gate.featureName);
    }
    if (gate.manualCommand) {
      if (commands.has(gate.manualCommand)) {
        throw internalError('capability/invalid-registry', `门禁手动命令重复： ${gate.manualCommand}`);
      }
      commands.add(gate.manualCommand);
    }
  }
  for (const gate of gates) {
    for (const [relation, references] of Object.entries({
      requires: gate.requires,
      before: gate.before,
      after: gate.after,
      conflicts: gate.conflicts,
    })) {
      for (const reference of references) {
        if (!ids.has(reference)) {
          throw internalError('capability/invalid-registry', `门禁 ${gate.id} 的 ${relation} 指向未知门禁 ${reference}`);
        }
        if (reference === gate.id) {
          throw internalError('capability/invalid-registry', `门禁 ${gate.id} 不能通过 ${relation} 指向自身`);
        }
      }
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const prerequisites = new Map(gates.map((gate) => [
    gate.id,
    new Set([...gate.requires, ...gate.after]),
  ]));
  for (const gate of gates) {
    for (const successor of gate.before) prerequisites.get(successor).add(gate.id);
  }
  const visit = (gateId) => {
    if (visiting.has(gateId)) throw internalError('capability/invalid-registry', `检测到门禁依赖环，起点为 ${gateId}`);
    if (visited.has(gateId)) return;
    visiting.add(gateId);
    for (const dependency of prerequisites.get(gateId)) visit(dependency);
    visiting.delete(gateId);
    visited.add(gateId);
  };
  for (const gate of gates) visit(gate.id);
}

export function createGateRegistry(gates) {
  if (!Array.isArray(gates)) throw new TypeError('门禁注册表必须是数组');
  const immutableGates = Object.freeze([...gates]);
  validateRegistry(immutableGates);
  const byId = new Map(immutableGates.map((gate) => [gate.id, gate]));
  const byCommand = new Map(
    immutableGates.filter(({ manualCommand }) => manualCommand)
      .map((gate) => [gate.manualCommand, gate]),
  );
  const byConfigKey = new Map(
    immutableGates.filter(({ configKey }) => configKey)
      .map((gate) => [gate.configKey, gate]),
  );
  return Object.freeze({
    all: immutableGates,
    configurable: Object.freeze(
      immutableGates
        .filter(({ featureName }) => featureName)
        .sort((left, right) => left.featureOrder - right.featureOrder),
    ),
    ci: Object.freeze(immutableGates.filter(({ ciScopes }) => ciScopes.length > 0)),
    get(id) {
      const gate = byId.get(id);
      if (!gate) throw internalError('capability/invalid-registry', `未知门禁： ${id}`);
      return gate;
    },
    findByManualCommand(command) {
      return byCommand.get(command) ?? null;
    },
    findByConfigKey(configKey) {
      return byConfigKey.get(configKey) ?? null;
    },
  });
}
