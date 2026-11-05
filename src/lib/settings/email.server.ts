import type { Sql } from "postgres";
import { emailSettingsSchema } from "./validation.ts";
export async function resolveEmailSettings(client: Sql) {
  const [row] = await client`select app.resolve_email_settings() as data`;
  const raw = row?.["data"];
  if (!raw) throw new Error("EMAIL_SETTINGS_UNAVAILABLE");
  const settings = emailSettingsSchema.parse({
    version: raw.version,
    sendingDomain: raw.sending_domain,
    displayName: raw.display_name,
    fromEmail: raw.from_email,
    replyTo: raw.reply_to,
    transactionalEnabled: raw.transactional_enabled,
    notificationsEnabled: raw.notifications_enabled,
  });
  return { ...settings, domainAuthorized: raw.domain_authorized === true };
}
