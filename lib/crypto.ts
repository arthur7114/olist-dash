import { createCipheriv, createDecipheriv, randomBytes } from "crypto"

// AES-256-GCM para cifrar tokens em repouso. Chave em CREDENTIALS_ENC_KEY (32 bytes base64).
function getKey(): Buffer {
  const raw = process.env.CREDENTIALS_ENC_KEY
  if (!raw) throw new Error("CREDENTIALS_ENC_KEY não configurado (32 bytes em base64).")
  const key = Buffer.from(raw, "base64")
  if (key.length !== 32) throw new Error("CREDENTIALS_ENC_KEY deve ter 32 bytes (base64).")
  return key
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv)
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":")
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(":")
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Formato de segredo inválido.")
  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivB64, "base64"))
  decipher.setAuthTag(Buffer.from(tagB64, "base64"))
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8")
}
