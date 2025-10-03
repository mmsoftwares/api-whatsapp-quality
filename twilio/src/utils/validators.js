// Chave NFe 44 dígitos (apenas números)
export const isNFeKey = (text) => {
  if (!text) return false;
  const onlyDigits = text.replace(/\D/g, "");
  return /^[0-9]{44}$/.test(onlyDigits);
};

// Extensão simples para PDF
export const isPdfByContentType = (ct) => /application\/pdf/i.test(ct || "");

// Extensão imagem comum
export const isImageByContentType = (ct) => /^image\//i.test(ct || "");
