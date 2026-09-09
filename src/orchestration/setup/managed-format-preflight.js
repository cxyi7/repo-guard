import { assertAgentPolicyFormat } from '../../policies/agent-policies.js';
import { workspaceAgentPolicyTargets } from '../workspace/targets.js';
import { assertDeliverySkillManifestFormat } from './delivery-skills.js';

/** 公共写入口先检查全部相关格式，避免后续拒绝旧文件时留下部分写入。 */
export function assertManagedDocumentFormats(root, { workspace = null, projectId } = {}) {
  assertDeliverySkillManifestFormat(root);
  const targets = workspace ? workspaceAgentPolicyTargets(workspace, projectId) : [{ root }];
  for (const target of targets) assertAgentPolicyFormat(target.root);
}
