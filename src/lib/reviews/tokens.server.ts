import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
export const digestInvitation = (token: string) => createHash("sha256").update(token).digest("hex");
function key(secret: string) {
  if (secret.length < 32) throw Error("Protected auth secret required for invitation delivery");
  return Buffer.from(
    hkdfSync("sha256", secret, "cape-clergy-vault", "reviewer-invitation-outbox-v1", 32),
  );
}
export function createInvitationProof(secret: string, identity: string) {
  const token = randomBytes(32).toString("base64url"),
    iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  cipher.setAAD(Buffer.from(identity));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return {
    digest: digestInvitation(token),
    sealed: [
      "v1",
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      ciphertext.toString("base64url"),
    ].join("."),
  };
}
export function openInvitationProof(sealed: string, secret: string, identity: string) {
  const [v, iv, tag, ciphertext] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !ciphertext) throw Error("Invalid proof envelope");
  const cipher = createDecipheriv("aes-256-gcm", key(secret), Buffer.from(iv, "base64url"));
  cipher.setAAD(Buffer.from(identity));
  cipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    cipher.update(Buffer.from(ciphertext, "base64url")),
    cipher.final(),
  ]).toString("utf8");
}
