import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';

const validate = new Ajv2020({ strict: false }).compile(JSON.parse(
  readFileSync(new URL('../../external-report.schema.json', import.meta.url), 'utf8'),
));

export function assertExternalReportSchema(report) {
  assert.equal(report.schemaVersion, 2);
  assert.equal(validate(report), true, JSON.stringify(validate.errors));
}
