// Schema migrations registry. Each entry: { version, name, up(store) }.
// Migrations run in order on store load for any version > meta.json schemaVersion.
export const migrations = [
  {
    version: 1,
    name: 'initial-schema',
    up(store) {
      // v1: collection files are initialized on load; nothing to migrate.
      // This marker establishes the registry and the schemaVersion contract.
      void store;
    },
  },
];

export const CURRENT_SCHEMA_VERSION = Math.max(...migrations.map((m) => m.version));
