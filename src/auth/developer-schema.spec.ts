import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('developer access migration/schema compatibility', () => {
  it('matches every migrated foreign key with Prisma-generated referential actions', () => {
    const backend = resolve(__dirname, '../..');
    const migration = readFileSync(resolve(backend, 'prisma/migrations/20261021060000_restricted_developer_login/migration.sql'), 'utf8');
    // Generate DDL without connecting to or mutating a database. This catches
    // Prisma's implicit referential-action defaults, unlike schema validation.
    const generated = execFileSync(process.execPath, [
      resolve(backend, 'node_modules/prisma/build/index.js'), 'migrate', 'diff',
      '--from-empty', '--to-schema-datamodel', resolve(backend, 'prisma/schema.prisma'), '--script',
    ], { cwd: backend, encoding: 'utf8', timeout: 90000, env: { ...process.env, CHECKPOINT_DISABLE: '1' } });
    const migrated: Array<{ table: string; column: string; target: string; targetColumn: string; onDelete: string; onUpdate: string }> = [];
    for (const table of migration.matchAll(/CREATE TABLE ats\.(developer_login_\w+)\s*\(([\s\S]*?)\n\);/g)) {
      for (const fk of table[2].matchAll(/^\s*(\w+)\s+[^\n]*?REFERENCES ats\.(\w+)\((\w+)\)([^\n]*)/gm)) {
        const action = (name: string) => fk[4].match(new RegExp(`ON ${name} (CASCADE|SET NULL|NO ACTION|RESTRICT)`, 'i'))?.[1].toUpperCase() || 'NO ACTION';
        migrated.push({ table: table[1], column: fk[1], target: fk[2], targetColumn: fk[3], onDelete: action('DELETE'), onUpdate: action('UPDATE') });
      }
    }
    expect(migrated).toHaveLength(4);
    const declared = [...generated.matchAll(/ALTER TABLE "ats"\."(developer_login_\w+)" ADD CONSTRAINT "[^"]+" FOREIGN KEY \("(\w+)"\) REFERENCES "ats"\."(\w+)"\("(\w+)"\) ON DELETE (CASCADE|SET NULL|NO ACTION|RESTRICT) ON UPDATE (CASCADE|SET NULL|NO ACTION|RESTRICT);/g)]
      .map(fk => ({ table: fk[1], column: fk[2], target: fk[3], targetColumn: fk[4], onDelete: fk[5], onUpdate: fk[6] }));
    expect(declared).toHaveLength(4);
    expect(declared).toEqual(expect.arrayContaining(migrated));
  }, 120000);
});
