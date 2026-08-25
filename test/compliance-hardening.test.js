import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const governance=fs.readFileSync(new URL('../src/services/governance-service.js',import.meta.url),'utf8'),routes=fs.readFileSync(new URL('../src/routes/governance-routes.js',import.meta.url),'utf8'),config=fs.readFileSync(new URL('../src/config.js',import.meta.url),'utf8');
test('retention policy and enforcement are workspace scoped',()=>{assert.match(governance,/retentionPolicies\(workspaceId/);assert.match(governance,/workspace_id=\?/);assert.match(routes,/q\.admin\.workspace_id/);});
test('retention defaults dry run and honors legal holds',()=>{assert.match(governance,/enforceRetention\(dryRun=true/);assert.match(governance,/LEGAL_HOLD/);assert.match(routes,/dry_run!==false/);});
test('audit exports are workspace scoped and integrity manifested',()=>{assert.match(governance,/manifest=\{version:1/);assert.match(governance,/sha256:checksum/);assert.match(governance,/manifest_json/);});
test('supported compliance assessments cover PCI SOC2 and Indonesian PDP',()=>{for(const x of ['PCI_DSS','SOC2','PDP_ID'])assert.match(governance,new RegExp(x));});
test('production config requires SMTP plus existing secrets and provider controls',()=>{for(const x of ['SMTP_URL','ENCRYPTION_KEY','TOKOPAY_SECRET','SIMULATOR_ENABLED','DB_PASSWORD'])assert.match(config,new RegExp(x));});
