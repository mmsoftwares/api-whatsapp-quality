// Em produção, troque por Redis/memcached. Aqui: memória simples + TTL.
const store = new Map();

export function wasProcessed(messageSid) {
  const item = store.get(messageSid);
  if (!item) return false;
  // TTL 24h
  if (Date.now() - item > 24 * 60 * 60 * 1000) {
    store.delete(messageSid);
    return false;
  }
  return true;
}

export function markProcessed(messageSid) {
  store.set(messageSid, Date.now());
}
