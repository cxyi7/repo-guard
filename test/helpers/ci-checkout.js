import { loadWorkspace } from "../../src/config/configuration-loader.js";
import { workspaceAgentPolicyTargets } from "../../src/orchestration/workspace/targets.js";
import { syncAgentPolicies } from "../../src/policies/agent-policies.js";
import { fixtureGit } from "./git-project.js";

export function synchronizeCiFixture(root) {
  for (const target of workspaceAgentPolicyTargets(loadWorkspace(root))) {
    syncAgentPolicies(target.root, target.config);
  }
}

export function commitCiFixture(root) {
  fixtureGit(root, ["add", "."]);
  fixtureGit(root, [
    "-c",
    "core.hooksPath=",
    "commit",
    "--allow-empty",
    "-m",
    "test: 固定本轮检查版本",
  ]);
  return fixtureGit(root, ["rev-parse", "HEAD"]);
}
