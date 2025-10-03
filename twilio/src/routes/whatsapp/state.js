// twilio/src/routes/whatsapp/state.js
import { SessionStore, STATES } from "../../state/sessionStore.js";

const sessions = new SessionStore({ ttlMs: 60 * 60 * 1000 });

export const setState = (from, state, extra = {}) => {
  const cur = getState(from);
  sessions.set(from, { ...cur, ...extra, state });
};

export const getState = (from) => sessions.get(from) || { state: STATES.IDLE };

export const updateState = (from, patch = {}) => {
  const cur = getState(from);
  sessions.set(from, { ...cur, ...patch });
};

export const clearState = (from) => {
  const cur = getState(from);
  if (cur && cur.cpf) {
    sessions.set(from, { cpf: cur.cpf, state: STATES.IDLE });
  } else {
    sessions.clear(from); // <=== usa o método 'clear' do SessionStore
  }
};

export { STATES };
