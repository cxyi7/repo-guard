import { randomUUID } from 'node:crypto';
import { executionError, toRepoGuardError } from '../../core/error/repo-guard-error.js';
import { backupData, restoreData, verifyDataResources } from './data.js';
import { prepareProxy, startCandidate, switchProxy, waitHealthy, runtimeEnvironment, verifyRelease } from './runtime.js';

const defaultActions = { backupData, restoreData, verifyDataResources, prepareProxy,
  startCandidate, switchProxy, waitHealthy, runtimeEnvironment, verifyRelease };

async function recoverPending(adapter, state, actions) {
  const pending = state.pending;
  if (!pending) throw executionError('operations/nothing-to-recover', '没有待恢复的部署。');
  actions.switchProxy(adapter, null, { maintenance: true });
  actions.verifyRelease(adapter, pending.old);
  if (pending.next) adapter.stop(pending.next.container);
  if (pending.old) adapter.stop(pending.old.container);
  if (pending.backupComplete) actions.restoreData(adapter, pending.restorePoint);
  if (pending.old) {
    adapter.docker(['start', pending.old.container]);
    await actions.waitHealthy(adapter, pending.old);
    actions.switchProxy(adapter, pending.old, { maintenance: true });
    await actions.waitHealthy(adapter, pending.old, { publicEntry: true });
    actions.switchProxy(adapter, pending.old);
  }
  const restored = { ...state, active: pending.old, pending: null, lastOutcome: 'recovered' };
  adapter.save(restored);
  return restored;
}

async function execute(adapter, operation, release, overrides, emit) {
  const actions = { ...defaultActions, ...overrides };
  if (operation === 'status') return adapter.state();
  adapter.initialize();
  const unlock = adapter.lock();
  let holdLock = false;
  try {
    let state = adapter.state();
    if (operation === 'recover') {
      await emit({ status: 'starting' });
      try { return await recoverPending(adapter, state, actions); }
      catch (cause) {
        if (cause.code === 'operations/docker-uncertain') holdLock = true;
        throw executionError('operations/recovery-failed', '恢复未完成，保留维护状态与恢复记录。', { cause });
      }
    }
    if (state.pending) throw executionError('operations/recovery-required', '存在中断的部署，须先执行 repo-guard ops recover。');
    if (!['deploy', 'rollback'].includes(operation)) throw executionError('operations/invalid-action', '不支持的部署操作。');
    if (operation === 'rollback' && !state.previous) throw executionError('operations/no-previous', '没有可恢复的上一版本。');
    actions.verifyRelease(adapter, state.active);
    if (operation === 'rollback') actions.verifyRelease(adapter, state.previous);
    const environment = operation === 'deploy' ? actions.runtimeEnvironment(adapter.config) : [];
    const backupEnabled = adapter.config.backup?.enabled === true;
    if (operation === 'rollback' && backupEnabled && !state.previous.restorePoint) {
      throw executionError('operations/backup-missing', '上一版本没有数据快照；请关闭备份后仅回退应用，或先准备正确的数据恢复方案。');
    }
    if (backupEnabled) actions.verifyDataResources(adapter);
    actions.prepareProxy(adapter);
    const color = state.active?.color === 'blue' ? 'green' : 'blue';
    const next = operation === 'rollback' ? state.previous : {
      ...release, color, container: `${adapter.name}-${color}`,
    };
    if (operation === 'deploy' && !/^sha256:[a-f0-9]{64}$/.test(next.image ?? '')) {
      throw executionError('operations/image-unbound', '部署必须绑定实际构建镜像摘要。');
    }
    const restorePoint = backupEnabled ? `backup-${randomUUID()}` : null;
    state = { ...state, pending: { operation, old: state.active, next, restorePoint, backupComplete: false } };
    adapter.save(state);
    await emit({ status: 'starting' });
    try {
      if (backupEnabled || !state.active) actions.switchProxy(adapter, null, { maintenance: true });
      if (backupEnabled && state.active) adapter.stop(state.active.container);
      // 停止待复用槽位，普通发布的当前应用继续服务。
      if (state.previous) adapter.stop(state.previous.container);
      if (backupEnabled) {
        actions.backupData(adapter, restorePoint);
        state.pending.backupComplete = true;
        adapter.save(state);
      }
      if (operation === 'rollback') {
        if (backupEnabled) actions.restoreData(adapter, next.restorePoint);
        if (!adapter.inspect('container', next.container)) throw executionError('operations/previous-missing', '上一版本容器已丢失，拒绝继续恢复。');
        adapter.docker(['start', next.container]);
      } else {
        // 候选槽位将被复用，原先该槽位的旧登记不能继续作为可回滚容器。
        state.previous = null;
        adapter.save(state);
        actions.startCandidate(adapter, next, environment);
      }
      await actions.waitHealthy(adapter, next);
      actions.switchProxy(adapter, next, { maintenance: backupEnabled });
      await actions.waitHealthy(adapter, next, { publicEntry: true });
      // 先持久化开放意图。中断后保持待恢复记录，不虚报成功。
      state.pending.phase = 'opening';
      adapter.save(state);
      if (backupEnabled) actions.switchProxy(adapter, next);
      if (state.active) adapter.stop(state.active.container);
      const result = { version: 2, name: adapter.name, active: next,
        previous: state.active ? { ...state.active, restorePoint } : null,
        pending: null, lastOutcome: 'passed', completedAt: new Date().toISOString() };
      adapter.save(result);
      adapter.write(`release-${randomUUID()}.json`, JSON.stringify(result));
      return result;
    } catch (cause) {
      if (cause.code === 'operations/docker-uncertain') {
        holdLock = true;
        throw toRepoGuardError(cause, { code: 'operations/deployment-error' });
      }
      let restored;
      try { restored = await recoverPending(adapter, state, actions); }
      catch (recovery) {
        if (recovery.code === 'operations/docker-uncertain') holdLock = true;
        throw executionError('operations/recovery-failed', '发布失败且恢复未完成，保持维护状态并保留恢复记录。', { cause, details: { recoveryCode: recovery.code ?? null } });
      }
      throw executionError('operations/deployment-failed', backupEnabled
        ? '本次发布失败，已恢复发布前应用和数据快照。' : '本次发布失败，已完成应用回退处理，当前数据保持不变。', { cause,
        details: { serviceRestored: Boolean(restored.active) } });
    }
  } finally { if (!holdLock) unlock(); }
}

/** 通知仅观察状态，发送异常不能打断部署或数据恢复。 */
export async function executeBlueGreen(adapter, operation, release = null, overrides = {}) {
  let started = false;
  let backupEnabled = adapter.config.backup?.enabled === true;
  const emit = async (event) => {
    if (event.status === 'starting') started = true;
    try { await overrides.onEvent?.({ operation, revision: release?.revision, backupEnabled, ...event }); }
    catch { /* 通知失败与部署结果隔离。 */ }
  };
  try {
    if (operation === 'recover') backupEnabled = adapter.state().pending?.backupComplete === true;
    const result = await execute(adapter, operation, release, overrides, emit);
    if (operation !== 'status') await emit({ status: 'passed', serviceRestored: Boolean(result.active), revision: result.active?.revision });
    return result;
  } catch (error) {
    if (operation !== 'status') await emit({ status: 'failed', started, error,
      serviceRestored: error.details?.serviceRestored === true });
    throw toRepoGuardError(error, { code: 'operations/deployment-error' });
  }
}
