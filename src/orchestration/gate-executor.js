export async function executeRegisteredGate({ gate, context }) {
  const setup = await gate.inspectSetup(context);
  if (setup && setup.status !== 'ready') {
    throw new Error(`${gate.id} setup is ${setup.status}: ${setup.summary}`);
  }
  const plan = await gate.plan(context);
  return await gate.run({ ...context, plan });
}
