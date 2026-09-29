// Compiles the .pres JSON Schema in strict mode and validates a manifest file
// given on the command line: node scripts/check-schema.mjs [manifest.json]
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';

const schema = JSON.parse(readFileSync(new URL('../schema/pres-format-v1.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, strictRequired: false, allowUnionTypes: true });
const validate = ajv.compile(schema);
console.log('Schema compiles.');
const file = process.argv[2];
if (file) {
  const ok = validate(JSON.parse(readFileSync(file, 'utf8')));
  if (!ok) {
    console.error(validate.errors.slice(0, 20));
    process.exit(1);
  }
  console.log(`${file} is valid.`);
}
