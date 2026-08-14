/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular-dependencies',
      severity: 'error',
      comment: 'A dependency cycle makes layer ownership and initialization order ambiguous.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-unresolvable-imports',
      severity: 'error',
      comment: 'Every local import must resolve so dependency boundaries cannot be bypassed with a broken target.',
      from: {},
      to: { path: '^(?:\\.{1,2}/|src/)', couldNotResolve: true },
    },
    {
      name: 'core-does-not-depend-on-platform-layers',
      severity: 'error',
      comment: 'Core contains stable contracts and utilities; it cannot depend on gates, orchestration, or integrations.',
      from: { path: '^src/core/' },
      to: { path: '^src/(?:gates/|orchestration/|integrations/|commands/|cli\\.js$)' },
    },
    {
      name: 'gates-do-not-depend-on-orchestration',
      severity: 'error',
      comment: 'A gate cannot know whether it is invoked by CLI, Hook, pre-push, or CI orchestration.',
      from: { path: '^src/gates/' },
      to: { path: '^src/(?:orchestration/|commands/|cli\\.js$)' },
    },
    {
      name: 'gates-do-not-import-report-renderers',
      severity: 'error',
      comment: 'Gates return structured results; only orchestration may invoke console or JSON renderers.',
      from: { path: '^src/gates/' },
      to: { path: '^src/core/report/' },
    },
    {
      name: 'gate-domains-do-not-deep-import-each-other',
      severity: 'error',
      comment: 'Gate composition belongs in the Registry and Execution Plans, not cross-domain implementation imports.',
      from: { path: '^src/gates/([^/]+)/' },
      to: { path: '^src/gates/(?!$1/)[^/]+/' },
    },
    {
      name: 'integrations-do-not-depend-on-policy-layers',
      severity: 'error',
      comment: 'Integrations return external facts and may use stable core types, but cannot decide gates or orchestration.',
      from: { path: '^src/integrations/' },
      to: { path: '^src/(?:gates/|orchestration/|commands/|cli\\.js$)' },
    },
    {
      name: 'integrations-do-not-import-policy-or-rendering',
      severity: 'error',
      comment: 'Integrations cannot own managed policy, capability selection, or user-facing rendering.',
      from: { path: '^src/integrations/' },
      to: { path: '^src/core/(?:capability|policy|report)/' },
    },
    {
      name: 'orchestration-entrypoints-do-not-call-integrations-directly',
      severity: 'error',
      comment: 'Execution Plans select gates; concrete external tool access remains behind gate implementations.',
      from: { path: '^src/(?:orchestration/|commands/|cli\\.js$)' },
      to: { path: '^src/integrations/' },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
      dependencyTypes: [
        'npm',
        'npm-dev',
        'npm-optional',
        'npm-peer',
        'npm-bundled',
        'npm-no-pkg',
      ],
    },
    moduleSystems: ['es6', 'cjs'],
    progress: { type: 'none' },
  },
};
