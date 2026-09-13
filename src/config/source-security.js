import {
  assertKnownProperties,
  configValidationError,
  normalizePatternList,
} from './validation-primitives.js';

export const SOURCE_SECURITY_GROUPS = Object.freeze({
  dynamicCode: Object.freeze({
    enabled: true,
    eval: true,
    functionConstructors: true,
    stringTimers: true,
  }),
  htmlInjection: Object.freeze({
    enabled: true,
    vueVHtml: true,
    domHtmlWrites: true,
    iframeSrcdoc: true,
    allowEmptyClear: true,
  }),
  inlineEventCode: Object.freeze({
    enabled: true,
    htmlEventAttributes: true,
    domEventAttributeWrites: true,
    stringEventPropertyWrites: true,
  }),
  urlScheme: Object.freeze({
    enabled: true,
    navigation: true,
    scriptSource: true,
  }),
  newWindow: Object.freeze({
    enabled: true,
    requireNoopener: true,
    requireNoreferrer: true,
    forbidOpener: true,
    checkWindowOpen: true,
  }),
  crossWindowMessage: Object.freeze({
    enabled: true,
    requireExplicitTargetOrigin: true,
    forbidWildcardTargetOrigin: true,
  }),
});

export const SOURCE_SECURITY_INCLUDE = Object.freeze([
  '**/*.{vue,js,jsx,mjs,cjs,ts,tsx,mts,cts,html}',
]);
export const SOURCE_SECURITY_EXCLUDE = Object.freeze([
  '**/node_modules/**',
  '**/.git/**',
]);

function booleanOptions(value, defaults, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw configValidationError(`${label} 必须是对象`);
  assertKnownProperties(value, new Set(Object.keys(defaults)), label);
  for (const [key, option] of Object.entries(value)) {
    if (typeof option !== 'boolean')
      throw configValidationError(`${label}.${key} 必须是布尔值`);
  }
  return { ...defaults, ...value };
}

export function validateSourceSecurity(value = {}, project) {
  const label = 'checks.sourceSecurity';
  assertKnownProperties(
    value,
    new Set([
      'enabled',
      'include',
      'exclude',
      ...Object.keys(SOURCE_SECURITY_GROUPS),
    ]),
    label,
  );
  const { enabled } = booleanOptions(
    Object.hasOwn(value, 'enabled') ? { enabled: value.enabled } : {},
    { enabled: project?.stack === 'node' },
    label,
  );
  return {
    enabled,
    include: normalizePatternList(
      value.include ?? SOURCE_SECURITY_INCLUDE,
      `${label}.include`,
    ),
    exclude: normalizePatternList(
      value.exclude ?? SOURCE_SECURITY_EXCLUDE,
      `${label}.exclude`,
      { allowEmpty: true },
    ),
    ...Object.fromEntries(
      Object.entries(SOURCE_SECURITY_GROUPS).map(([group, defaults]) => [
        group,
        booleanOptions(
          value[group] ?? {},
          project?.role === 'backend'
            ? {
                ...defaults,
                enabled: group === 'dynamicCode',
                ...(group === 'dynamicCode' ? { stringTimers: false } : {}),
              }
            : defaults,
          `${label}.${group}`,
        ),
      ]),
    ),
  };
}
