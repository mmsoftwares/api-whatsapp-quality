// Ajustado para aceitar tanto número quanto objeto { ttlMs }, e com .del()
export const STATES = {
  IDLE: "IDLE",
  MENU: "MENU",
  AWAIT_CPF: "AWAIT_CPF",

  AWAIT_ENTREGA: "AWAIT_ENTREGA",
  AWAIT_OCO: "AWAIT_OCO",
  AWAIT_OCO_MOTIVO: "AWAIT_OCO_MOTIVO",

  AWAIT_CTE_MEDIA: "AWAIT_CTE_MEDIA",
  AWAIT_BAIXA_CONFIRMA: "AWAIT_BAIXA_CONFIRMA",
  AWAIT_ID_MEDIA: "AWAIT_ID_MEDIA",
  AWAIT_VEHICLE_MEDIA: "AWAIT_VEHICLE_MEDIA",
};

export class SessionStore {
  constructor(opts = 10 * 60 * 1000) {
    // aceita number (ms) ou objeto { ttlMs }
    const ttlMs =
      typeof opts === "number"
        ? opts
        : (opts && typeof opts.ttlMs === "number" ? opts.ttlMs : 10 * 60 * 1000);

    this.ttlMs = ttlMs;
    this.map = new Map();
    this.timer = setInterval(() => this.sweep(), this.ttlMs);
    if (this.timer.unref) this.timer.unref();
  }

  sweep() {
    const now = Date.now();
    for (const [k, v] of this.map.entries()) {
      if (now > v.exp) this.map.delete(k);
    }
  }

  get(key) {
    const item = this.map.get(key);
    if (!item) return null;
    if (Date.now() > item.exp) {
      this.map.delete(key);
      return null;
    }
    return item.data;
  }

  set(key, data) {
    this.map.set(key, { data, exp: Date.now() + this.ttlMs });
  }

  clear(key) {
    this.map.delete(key);
  }

  // alias para compatibilidade com quem usa .del()
  del(key) {
    this.clear(key);
  }
}
