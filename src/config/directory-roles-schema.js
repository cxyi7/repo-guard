import { DIRECTORY_BINDING_TARGETS } from './directory-roles.js';

export const DIRECTORY_ROLES_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['entries'],
  description: '应用独立的目录职责与路径绑定；只声明用途，不证明代码语义。缺省字段采用绑定模板，用户显式路径优先。',
  properties: {
    entries: {
      type: 'object', maxProperties: 64,
      propertyNames: { pattern: '^[a-z][a-zA-Z0-9-]*$', not: { enum: ['constructor', 'prototype', '__proto__'] } },
      additionalProperties: {
        type: 'object', additionalProperties: false, required: ['path', 'purpose'],
        properties: {
          path: { type: 'string', minLength: 1, maxLength: 1024, pattern: '^[^\\r\\n\\u0000]+$', description: '相对应用根目录的字面路径，允许引用其他职责，例如 ${source}/utils；不接受越界或 glob。' },
          purpose: { type: 'string', minLength: 1, maxLength: 1000, pattern: '^[^\\r\\n\\u0000]+$', description: '目录的团队用途说明，供开发者与 AI 遵循。' },
        },
      },
    },
    bindings: {
      type: 'object', maxProperties: 128,
      propertyNames: { enum: DIRECTORY_BINDING_TARGETS },
      additionalProperties: {
        type: 'object', additionalProperties: false, required: ['format', 'value'],
        properties: {
          format: { enum: ['path', 'glob', 'regex'], description: '引用路径用于普通路径、glob 或正则；正则模式对目录字面值转义。' },
          value: { description: '字段模板，可嵌套 JSON 值；${职责标识} 引用目录，展开后仍受原检查字段的严格校验。' },
        },
      },
    },
  },
};
