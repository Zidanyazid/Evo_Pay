const exact = new Set(['/.env', '/package.json', '/package-lock.json']);

export const sensitivePath = (value = '') => exact.has(value) || value.startsWith('/src/') || value === '/.git' || value.startsWith('/.git/');
