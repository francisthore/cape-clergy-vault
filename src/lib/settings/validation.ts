import { z } from "zod";
export const emailSettingsSchema = z
  .object({
    version: z.number().int().positive(),
    sendingDomain: z
      .string()
      .trim()
      .toLowerCase()
      .max(253)
      .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/),
    displayName: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[^<>\r\n]+$/),
    fromEmail: z.string().trim().email().max(254),
    replyTo: z.union([z.literal(""), z.string().trim().email().max(254)]),
    transactionalEnabled: z.boolean(),
    notificationsEnabled: z.boolean(),
  })
  .strict()
  .refine((v) => v.fromEmail.split("@")[1] === v.sendingDomain, {
    message: "Sender must use the authorized sending domain.",
  });
