export function normalizeCmd(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

export function isCmd(s, ...alts) {
  const S = normalizeCmd(s);
  return alts.map(normalizeCmd).includes(S);
}
