// Format migrations (spec §10.7). Pure, deterministic functions between adjacent
// versions. Version 1 is the first shipped version, so no migrations exist yet;
// add them here as MIGRATIONS[n] = (docAtVersionN) => docAtVersionN+1.
export const CURRENT_FORMAT_VERSION = 1;

export const MIGRATIONS = {};

export class MigrationError extends Error {
  constructor(message, feature) {
    super(message);
    this.name = 'MigrationError';
    this.feature = feature;
  }
}

export class NewerVersionError extends Error {
  constructor(version) {
    super(`This file was made by a newer version of the app (format ${version}). Update the app to open this file.`);
    this.name = 'NewerVersionError';
    this.version = version;
  }
}

export function migrateDocument(doc, fromVersion) {
  if (!Number.isInteger(fromVersion) || fromVersion < 1) throw new MigrationError(`Unknown format version ${fromVersion}`);
  if (fromVersion > CURRENT_FORMAT_VERSION) throw new NewerVersionError(fromVersion);
  let current = doc;
  for (let v = fromVersion; v < CURRENT_FORMAT_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) throw new MigrationError(`No migration from format ${v} to ${v + 1}`);
    current = step(current);
  }
  return current;
}

export function needsMigration(version) {
  return version < CURRENT_FORMAT_VERSION;
}
