function validateRegistry(gates) {
  const ids = new Set();
  const commands = new Set();
  const configKeys = new Set();
  const featureNames = new Set();
  for (const gate of gates) {
    if (ids.has(gate.id)) throw new Error(`Duplicate gate id: ${gate.id}`);
    ids.add(gate.id);
    if (gate.configKey) {
      if (configKeys.has(gate.configKey)) {
        throw new Error(`Duplicate gate config key: ${gate.configKey}`);
      }
      configKeys.add(gate.configKey);
    }
    if (gate.featureName) {
      if (featureNames.has(gate.featureName)) {
        throw new Error(`Duplicate gate feature name: ${gate.featureName}`);
      }
      featureNames.add(gate.featureName);
    }
    if (gate.manualCommand) {
      if (commands.has(gate.manualCommand)) {
        throw new Error(`Duplicate gate manual command: ${gate.manualCommand}`);
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
          throw new Error(`Gate ${gate.id} ${relation} unknown gate ${reference}`);
        }
        if (reference === gate.id) {
          throw new Error(`Gate ${gate.id} cannot ${relation} itself`);
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
    if (visiting.has(gateId)) throw new Error(`Gate dependency cycle detected at ${gateId}`);
    if (visited.has(gateId)) return;
    visiting.add(gateId);
    for (const dependency of prerequisites.get(gateId)) visit(dependency);
    visiting.delete(gateId);
    visited.add(gateId);
  };
  for (const gate of gates) visit(gate.id);
}

export function createGateRegistry(gates) {
  if (!Array.isArray(gates)) throw new TypeError('Gate registry must be an array');
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
    get(id) {
      const gate = byId.get(id);
      if (!gate) throw new Error(`Unknown gate: ${id}`);
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
