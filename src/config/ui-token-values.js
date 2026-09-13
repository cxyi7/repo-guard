import {
  assertKnownProperties,
  configValidationError,
  normalizePatternList,
  normalizeRelativePattern,
} from "./validation-primitives.js";
import { UI_TOKEN_LANGUAGES } from "./defaults.js";

const textSchema = { type: "string", minLength: 1, pattern: ".*\\S.*" };
const conditionsSchema = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["name", "params"],
    properties: { name: textSchema, params: textSchema },
  },
};
const outputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["selector", "property"],
  properties: {
    selector: textSchema,
    property: { ...textSchema, description: '生成 CSS 的属性名；普通属性忽略大小写，自定义属性保留大小写。' },
    value: textSchema,
    conditions: conditionsSchema,
  },
};
export const UI_TOKEN_VALUES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    enabled: { type: "boolean", default: false },
    definitions: {
      type: "array",
      default: [],
      items: {
        type: "object",
        additionalProperties: false,
        required: ["token", "source", "language", "alias", "selector", "value"],
        properties: {
          token: textSchema,
          source: textSchema,
          language: { enum: UI_TOKEN_LANGUAGES },
          alias: textSchema,
          selector: { type: "string" },
          value: textSchema,
          conditions: conditionsSchema,
          outputs: { type: "array", items: outputSchema },
        },
      },
    },
  },
};
export const UI_TOKEN_ARTIFACTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    enabled: { type: "boolean", default: false },
    patterns: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: textSchema,
      default: ["**/*.css"],
    },
  },
};

function object(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw configValidationError(`${label} 必须是对象`);
  assertKnownProperties(value, new Set(fields), label);
}
function text(value, label, empty = false) {
  if (typeof value !== "string" || (!empty && !value.trim()))
    throw configValidationError(`${label} 必须是${empty ? "" : "非空"}字符串`);
  return value.trim();
}
function enabled(value, label) {
  if (value !== undefined && typeof value !== "boolean")
    throw configValidationError(`${label}.enabled 必须是布尔值`);
  return value ?? false;
}
function array(value, label) {
  if (!Array.isArray(value)) throw configValidationError(`${label} 必须是数组`);
  return value;
}
function conditions(value, label) {
  return array(value === undefined ? [] : value, label).map((condition) => {
    object(condition, ["name", "params"], label);
    const name = text(condition.name, label + ".name");
    if (!/^[a-z-]+$/.test(name))
      throw configValidationError(
        `${label}.name 必须是小写 at-rule 名称，不带 @`,
      );
    return { name, params: text(condition.params, label + ".params") };
  });
}

/** 指定值和产物映射显式保存，关闭时仍验证并保留配置。 */
export function validateUiTokenValues(value, label) {
  const values = value.values === undefined ? {} : value.values;
  const artifacts = value.artifacts === undefined ? {} : value.artifacts;
  object(values, ["enabled", "definitions"], label + ".values");
  object(artifacts, ["enabled", "patterns"], label + ".artifacts");
  const definitions = array(
    values.definitions === undefined ? [] : values.definitions,
    label + ".values.definitions",
  ).map((entry, index) => {
    const at = `${label}.values.definitions[${index}]`;
    object(
      entry,
      [
        "token",
        "source",
        "language",
        "alias",
        "selector",
        "value",
        "conditions",
        "outputs",
      ],
      at,
    );
    if (!UI_TOKEN_LANGUAGES.includes(entry.language))
      throw configValidationError(`${at}.language 必须是 css、sass 或 less`);
    const source = normalizeRelativePattern(
      text(entry.source, at + ".source"),
      at + ".source",
    );
    if (/[*?{}[\]]/.test(source))
      throw configValidationError(`${at}.source 必须是确定文件路径`);
    const outputs = array(
      entry.outputs === undefined ? [] : entry.outputs,
      at + ".outputs",
    ).map((output) => {
      object(
        output,
        ["selector", "property", "value", "conditions"],
        at + ".outputs",
      );
      return {
        selector: text(output.selector, at + ".outputs.selector"),
        property: text(output.property, at + ".outputs.property"),
        ...(output.value !== undefined
          ? { value: text(output.value, at + ".outputs.value") }
          : {}),
        conditions: conditions(output.conditions, at + ".outputs.conditions"),
      };
    });
    return {
      token: text(entry.token, at + ".token"),
      source,
      language: entry.language,
      alias: text(entry.alias, at + ".alias"),
      selector: text(entry.selector, at + ".selector", true),
      value: text(entry.value, at + ".value"),
      conditions: conditions(entry.conditions, at + ".conditions"),
      outputs,
    };
  });
  const active = enabled(values.enabled, label + ".values");
  if (active && !definitions.length)
    throw configValidationError(
      `${label} 指定值检查启用后必须提供非空定义列表`,
    );
  const outputActive = enabled(artifacts.enabled, label + ".artifacts");
  if (
    outputActive &&
    (!active || definitions.some((entry) => !entry.outputs.length))
  )
    throw configValidationError(
      `${label} 产物检查要求开启指定值检查，并为每项定义提供输出映射`,
    );
  return {
    values: { enabled: active, definitions },
    artifacts: {
      enabled: outputActive,
      patterns: normalizePatternList(
        artifacts.patterns === undefined ? ["**/*.css"] : artifacts.patterns,
        label + ".artifacts.patterns",
      ),
    },
  };
}
