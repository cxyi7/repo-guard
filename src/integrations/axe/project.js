import { resolveProjectPackageMetadata } from '../../core/project/package.js';

const INTEGRATIONS = Object.freeze([
  Object.freeze({
    id: 'vitest-axe',
    packageName: 'vitest-axe',
    displayName: 'vitest-axe',
    scan: /\baxe\s*\(/,
    assertion: /\btoHaveNoViolations\s*\(/,
  }),
  Object.freeze({
    id: 'jest-axe',
    packageName: 'jest-axe',
    displayName: 'jest-axe',
    scan: /\baxe\s*\(/,
    assertion: /\btoHaveNoViolations\s*\(/,
  }),
  Object.freeze({
    id: 'playwright',
    packageName: '@axe-core/playwright',
    displayName: '@axe-core/playwright',
    scan: /\bnew\s+AxeBuilder\s*\([^)]*\)[\s\S]*?\.analyze\s*\(/,
    assertion: /\.violations\b[\s\S]{0,300}?(?:toEqual\s*\(\s*\[\s*\]\s*\)|toHaveLength\s*\(\s*0\s*\))|(?:toEqual\s*\(\s*\[\s*\]\s*\)|toHaveLength\s*\(\s*0\s*\))[\s\S]{0,300}?\.violations\b/,
  }),
  Object.freeze({
    id: 'cypress',
    packageName: 'cypress-axe',
    displayName: 'cypress-axe',
    scan: /\bcy\s*\.\s*checkA11y\s*\(/,
    assertion: /\bcy\s*\.\s*checkA11y\s*\(/,
    setup: /\bcy\s*\.\s*injectAxe\s*\(/,
  }),
  Object.freeze({
    id: 'axe-core',
    packageName: 'axe-core',
    displayName: 'axe-core',
    scan: /\baxe\s*\.\s*run\s*\(/,
    assertion: /\.violations\b[\s\S]{0,300}?(?:toEqual\s*\(\s*\[\s*\]\s*\)|toHaveLength\s*\(\s*0\s*\))|(?:toEqual\s*\(\s*\[\s*\]\s*\)|toHaveLength\s*\(\s*0\s*\))[\s\S]{0,300}?\.violations\b/,
  }),
]);

function importedIntegration(code) {
  return INTEGRATIONS.find(({ packageName }) => (
    new RegExp(
      `(?:from\\s*|import\\s*(?:\\(|)|require\\s*\\()\\s*['"]${packageName.replace('/', '\\/')}['"]`,
    ).test(code)
  ));
}

export function inspectAxeIntegration(imports, code) {
  const integration = importedIntegration(imports);
  if (!integration) return null;
  return Object.freeze({
    id: integration.id,
    packageName: integration.packageName,
    assertion: integration.assertion.test(code),
    scan: integration.scan.test(code),
    setup: integration.setup ? integration.setup.test(code) : true,
  });
}

export function resolveAxeIntegrationPackage(root, packageName) {
  const integration = INTEGRATIONS.find((item) => item.packageName === packageName);
  return resolveProjectPackageMetadata(
    root,
    packageName,
    integration?.displayName ?? packageName,
  );
}
