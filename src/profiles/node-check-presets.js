/** 只在新建配置时写入后端开关，不改变已有配置的省略值或显式设置。 */
export function nodeCheckPresets(project) {
  if (project?.role !== 'backend' || project.stack !== 'node') return {};
  return {
    ...Object.fromEntries([
      'build', 'unitTest', 'coverage', 'mutationTest',
      'architecture', 'deadCode', 'pathNaming', 'functionDocs', 'fileHeader',
    ].map((feature) => [feature, { enabled: true }])),
    typeCheck: { enabled: project.preset === 'node-typescript' },
  };
}
