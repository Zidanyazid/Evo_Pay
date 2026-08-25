import 'dotenv/config';
/**
 * Automated migration script: SQLite → MySQL
 * Transforms db.prepare(...).get/run/all() → await db.get/run/all()
 * And adds async to functions containing DB calls.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

const filesToMigrate = [
  // Services
  ...fs.readdirSync(path.join(ROOT, 'src/services'))
    .filter(f => f.endsWith('.js') && !['outbound-url-policy.js'].includes(f))
    .map(f => path.join(ROOT, 'src/services', f)),
  // Routes
  ...fs.readdirSync(path.join(ROOT, 'src/routes'))
    .filter(f => f.endsWith('.js'))
    .map(f => path.join(ROOT, 'src/routes', f)),
  // Server
  path.join(ROOT, 'src/server.js'),
  // DB maintenance script
  path.join(ROOT, 'scripts/database-maintenance.js'),
];

// Files already manually migrated
const done = new Set([
  'audit-service.js', 'fee-service.js', 'routing-service.js', 'provider-service.js',
  'security-service.js', 'job-service.js',
  'merchant-auth.js', 'authorization.js', 'idempotency.js',
]);

let migrated = 0, skipped = 0;

for (const filePath of filesToMigrate) {
  const base = path.basename(filePath);
  if (done.has(base)) { skipped++; continue; }
  
  let code = fs.readFileSync(filePath, 'utf8');
  const orig = code;
  
  // 1. Replace db.prepare('...').get(...) → await db.get('...', [...])
  //    Patterns: db.prepare(SQL).get(args) | db.prepare(SQL).all(args) | db.prepare(SQL).run(args)
  code = code.replace(/db\.prepare\(([^)]+)\)\.(get|all|run)\(([^)]*)\)/g, (match, sql, method, args) => {
    const argsArray = args.trim() ? `[${args}]` : '[]';
    return `await db.${method}(${sql}, ${argsArray})`;
  });
  
  // 2. Replace db.exec(`...`) → await db.exec(`...`)
  code = code.replace(/(?<!await\s)db\.exec\(/g, 'await db.exec(');
  
  // 3. Replace db.transaction(() => { ... })() patterns
  //    This is complex; handle simple cases
  code = code.replace(/db\.transaction\(\(\) => \{/g, 'await db.transaction(async (tx) => {');
  code = code.replace(/db\.transaction\(\(\)=>\{/g, 'await db.transaction(async (tx)=>{');
  // Remove the extra ()  at end of transaction calls
  code = code.replace(/\}\)\(\)/g, '})');
  
  // 4. Inside transactions, replace db. calls with tx. calls
  // This is tricky with regex — do a simple pass
  code = code.replace(/await db\.transaction\(async \(tx\)[= >]*\{([\s\S]*?)\}\)/g, (match, body) => {
    const fixed = body
      .replace(/await db\.(get|all|run)\(/g, 'await tx.$1(');
    return `await db.transaction(async (tx) => {${fixed}})`;
  });
  
  // 5. SQLite-specific → MySQL
  code = code.replace(/datetime\('now','-(\d+) (hour|day|minute)s?'\)/g, 
    (_, n, unit) => `DATE_SUB(NOW(),INTERVAL ${n} ${unit.toUpperCase()})`);
  code = code.replace(/datetime\('now','-(\d+) (hour|day|minute)s?'\)/gi, 
    (_, n, unit) => `DATE_SUB(NOW(),INTERVAL ${n} ${unit.toUpperCase()})`);
  // PRAGMA calls
  code = code.replace(/db\.pragma\([^)]+\);?/g, '');
  // db.close()
  code = code.replace(/(?<!await\s)db\.close\(\)/g, 'await db.close()');
  
  // 6. Make exported functions async if they contain await
  //    Simple heuristic: if function body has 'await ', make it async
  // Handle: export function name(
  code = code.replace(/export function (\w+)\(/g, (match, name) => {
    return `export async function ${name}(`;
  });
  // Handle: function name( (non-export)
  // Only if the function uses await
  // Handle class methods 
  // This is hard to do perfectly with regex, so we'll be conservative
  
  if (code !== orig) {
    fs.writeFileSync(filePath, code);
    migrated++;
    console.log(`✅ Migrated: ${base}`);
  } else {
    console.log(`⏭️  No changes: ${base}`);
    skipped++;
  }
}

console.log(`\nDone. Migrated: ${migrated}, Skipped: ${skipped}`);
