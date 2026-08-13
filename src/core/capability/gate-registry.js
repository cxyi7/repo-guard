function validateRegistry(gates) {
  const ids = new Set();
  const commands = new Set();
  for (const gate of gates) {
    if (ids.has(gate.id)) throw new Error(`Duplicate gate id: ${gate.id}`);
    ids.add(gate.id);
    if (gate.manualCommand) {
      if (commands.has(gate.manualCommand)) {
        throw new Error(`Duplicate gate manual command: ${gate.manualCommand}`);
      }
      commands.add(gate.manualCommand);
    }
  }
  for (const gate of gates) {
    for (const dependency of gate.requires) {
      if (!ids.has(dependency)) {
        throw new Error(`Gate ${gate.id} requires unknown gate ${dependency}`);
      }
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (gateId) => {
    if (visiting.has(gateId)) throw new Error(`Gate dependency cycle detected at ${gateId}`);
    if (visited.has(gateId)) return;
    visiting.add(gateId);
    const gate = gates.find(({ id }) => id === gateId);
    for (const dependency of gate.requires) visit(dependency);
    visiting.delete(gateId);
    visited.add(gateId);
  };
  for (const gate of gates) visit(gate.id);
}

export function createGateRegistry(gates) {
  if (!Array.isArray(gates)) throw new TypeError('Gate registry must be an array');
  validateRegistry(gates);
  const byId = new Map(gates.map((gate) => [gate.id, gate]));
  const byCommand = new Map(
    gates.filter(({ manualCommand }) => manualCommand)
      .map((gate) => [gate.manualCommand, gate]),
  );
  return Object.freeze({
    all: Object.freeze([...gates]),
    get(id) {
      const gate = byId.get(id);
      if (!gate) throw new Error(`Unknown gate: ${id}`);
      return gate;
    },
    findByManualCommand(command) {
      return byCommand.get(command) ?? null;
    },
  });
}
