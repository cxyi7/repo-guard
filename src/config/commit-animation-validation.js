import {
  assertKnownProperties,
  configValidationError,
} from './validation-primitives.js';

export const DEFAULT_COMMIT_ANIMATION_CONFIG = Object.freeze({
  enabled: false,
  theme: 'cat',
  commitTypeProps: true,
});

export function validateCommitAnimationConfiguration(value, configPath) {
  const supplied =
    value.commitAnimation === undefined ? {} : value.commitAnimation;
  const location = `${configPath} commitAnimation`;
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) {
    throw configValidationError(`${location} 必须是对象`);
  }
  assertKnownProperties(
    supplied,
    new Set(Object.keys(DEFAULT_COMMIT_ANIMATION_CONFIG)),
    location,
  );
  const config = { ...DEFAULT_COMMIT_ANIMATION_CONFIG, ...supplied };
  for (const key of ['enabled', 'commitTypeProps']) {
    if (typeof config[key] !== 'boolean')
      throw configValidationError(`${location}.${key} 必须是布尔值`);
  }
  if (!['cat', 'dog'].includes(config.theme)) {
    throw configValidationError(
      `${location}.theme 只能是 cat（小猫）或 dog（小狗）`,
    );
  }
  return config;
}
