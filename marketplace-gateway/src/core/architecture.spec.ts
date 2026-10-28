import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// core is the hexagon: it never depends on a framework, a driver or an adapter.
const FORBIDDEN_PACKAGES = ['express', 'knex', 'pg', 'pino', 'kafkajs'];
const FORBIDDEN_SCOPES = ['@opentelemetry/'];
const CORE_DIR = __dirname;
const INFRA_DIR = path.join(CORE_DIR, '..', 'infra');
const IMPORT_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;

function forbiddenImports(source: string, fileDir: string): string[] {
  return [...source.matchAll(IMPORT_SPECIFIER)]
    .map(match => match[1])
    .filter(specifier => isForbidden(specifier, fileDir));
}

function isForbidden(specifier: string, fileDir: string): boolean {
  if (specifier.startsWith('.')) {
    const target = path.resolve(fileDir, specifier);
    return target === INFRA_DIR || target.startsWith(INFRA_DIR + path.sep);
  }
  return (
    FORBIDDEN_PACKAGES.some(pkg => specifier === pkg || specifier.startsWith(`${pkg}/`)) ||
    FORBIDDEN_SCOPES.some(scope => specifier.startsWith(scope))
  );
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [fullPath] : [];
  });
}

describe('core architecture', () => {
  it('has no import of a framework, a driver or an infra module', () => {
    const violations = sourceFiles(CORE_DIR).flatMap(file =>
      forbiddenImports(readFileSync(file, 'utf8'), path.dirname(file)).map(
        specifier => `${path.relative(CORE_DIR, file)} imports ${specifier}`,
      ),
    );

    expect(violations).toEqual([]);
  });

  it.each([
    "import express from 'express';",
    "import { Knex } from 'knex';",
    "import { Pool } from 'pg';",
    "import pino from 'pino';",
    "import { Kafka } from 'kafkajs';",
    "import { trace } from '@opentelemetry/api';",
    "const { Client } = require('pg/lib/client');",
    "import { loadConfig } from '../../../infra/config/env';",
  ])('detects the forbidden import in %s', source => {
    expect(forbiddenImports(source, path.join(CORE_DIR, 'listing', 'model'))).toHaveLength(1);
  });

  it('allows core-internal and Node imports', () => {
    const source = "import { Id } from '../shared/domain/id';\nimport { randomUUID } from 'node:crypto';";

    expect(forbiddenImports(source, path.join(CORE_DIR, 'listing'))).toEqual([]);
  });
});
