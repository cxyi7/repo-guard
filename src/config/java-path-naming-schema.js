export const JAVA_PATH_NAMING_CONVENTIONS = Object.freeze([
  "PascalCase",
  "camelCase",
  "lowercase",
  "kebab-case",
  "snake_case",
]);

const glob = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern:
    "^(?!\\s|.*\\s$|/|.*/$|.*//|.*(?:^|/)\\.{1,2}(?:/|$)|.*(?:[^/]\\*\\*|\\*\\*[^/]))[^\\\\:\\x00-\\x1f\\x7f\\[\\]{}()!|^$+]+$",
};
const globs = { type: "array", maxItems: 64, uniqueItems: true, items: glob };
const basename = {
  ...globs,
  items: {
    ...glob,
    pattern:
      "^(?!\\s|.*\\s$|\\.{1,2}$|.*\\*\\*)[^/\\\\:\\x00-\\x1f\\x7f\\[\\]{}()!|^$+]+$",
  },
};

export const JAVA_PATH_NAMING_SCHEMA_PROPERTIES = Object.freeze({
  javaPathNaming: {
    type: "object",
    additionalProperties: false,
    properties: {
      enabled: { type: "boolean", default: false },
      include: { ...globs, minItems: 1 },
      exclude: globs,
      rules: {
        type: "array",
        minItems: 1,
        maxItems: 64,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "target", "include"],
          properties: {
            id: { type: "string", pattern: "^[a-z][a-z0-9-]{0,63}$" },
            target: { enum: ["files", "directories"] },
            include: { ...globs, minItems: 1 },
            exclude: globs,
            conventions: {
              type: "array",
              maxItems: JAVA_PATH_NAMING_CONVENTIONS.length,
              uniqueItems: true,
              items: { enum: JAVA_PATH_NAMING_CONVENTIONS },
            },
            basename,
          },
          anyOf: [
            {
              required: ["conventions"],
              properties: { conventions: { type: "array", minItems: 1 } },
            },
            {
              required: ["basename"],
              properties: { basename: { type: "array", minItems: 1 } },
            },
          ],
        },
      },
    },
  },
});
