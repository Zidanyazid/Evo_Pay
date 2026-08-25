import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import db, { id, now } from '../src/database.js';
import { IpAllowlistService, cidrContains, normalizeCidr, normalizeIp } from '../src/services/ip-allowlist-service.js';

const service = new IpAllowlistService();
after(()=>db.close());
const insertMerchant = async (merchantId, name) => db.run('INSERT INTO merchants (id,name,api_key_hash,created_at) VALUES (?,?,?,?)', [merchantId, name, id('hash'), now()]);
const cleanup = async (...merchantIds) => {
  if (!merchantIds.length) return;
  await db.run(`DELETE FROM merchant_ip_allowlist WHERE merchant_id IN (${merchantIds.map(() => '?').join(',')})`, merchantIds);
  await db.run(`DELETE FROM merchants WHERE id IN (${merchantIds.map(() => '?').join(',')})`, merchantIds);
};

test('normalizes IPv4, mapped IPv4, and host CIDR', () => {
  assert.equal(normalizeIp('::ffff:127.0.0.1'), '127.0.0.1');
  assert.equal(normalizeCidr('203.0.113.42'), '203.0.113.42/32');
  assert.equal(normalizeCidr('203.0.113.42/24'), '203.0.113.0/24');
});

test('matches IPv4 and IPv6 CIDR boundaries', () => {
  assert.equal(cidrContains('203.0.113.0/24', '203.0.113.99'), true);
  assert.equal(cidrContains('203.0.113.0/24', '203.0.114.1'), false);
  assert.equal(cidrContains('2001:db8::/32', '2001:db8::10'), true);
  assert.equal(cidrContains('2001:db8::/32', '2001:db9::10'), false);
});

test('rejects invalid CIDR', () => {
  assert.throws(() => normalizeCidr('999.1.1.1'), /tidak valid/);
  assert.throws(() => normalizeCidr('10.0.0.1/33'), /0–32/);
});

test('enforces active rules per merchant and ignores inactive rules', async () => {
  const mid = id('m_ip');
  await insertMerchant(mid, 'IP Test');
  try {
    assert.equal((await service.evaluate({ id: mid, ip_allowlist: null }, '198.51.100.1')).enforced, false);
    const rule = await service.create(mid, { cidr: '198.51.100.0/24', label: 'Prod' });
    assert.equal((await service.evaluate({ id: mid }, '198.51.100.8')).allowed, true);
    assert.equal((await service.evaluate({ id: mid }, '203.0.113.8')).allowed, false);
    await service.toggle(mid, rule.id, false);
    assert.equal((await service.evaluate({ id: mid }, '203.0.113.8')).enforced, false);
    await service.toggle(mid, rule.id, true);
    await assert.rejects(() => service.create(mid, { cidr: '198.51.100.2/24' }), (e) => e.code === 'IP_ALLOWLIST_DUPLICATE');
  } finally {
    await cleanup(mid);
  }
});

test('tenant isolation prevents reading or deleting another merchant rule', async () => {
  const a = id('m_ip');
  const b = id('m_ip');
  await insertMerchant(a, 'A');
  await insertMerchant(b, 'B');
  try {
    const rule = await service.create(a, { cidr: '10.10.0.0/16' });
    await assert.rejects(() => service.get(b, rule.id), (e) => e.code === 'IP_ALLOWLIST_NOT_FOUND');
    await assert.rejects(() => service.remove(b, rule.id), (e) => e.code === 'IP_ALLOWLIST_NOT_FOUND');
  } finally {
    await cleanup(a, b);
  }
});
