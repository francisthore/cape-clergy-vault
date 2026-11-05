import { z } from "zod";
import { POPIA_POINTS } from "../popia.ts";

// Existing project wording, explicitly a local draft; no claim of legal approval.
export const registrationNotice = {
  version: "repository-v1",
  label: "Draft privacy notice — local testing only; legal approval outstanding",
  points: POPIA_POINTS,
};
export const emailSchema = z
  .string()
  .trim()
  .email("Enter a valid email address")
  .max(255)
  .transform((s) => s.toLowerCase());
export const profileSchema = z
  .object({
    title: z.string().trim().min(1).max(40),
    fullName: z.string().trim().min(2, "Enter your full name").max(120),
    parish: z.string().trim().min(2, "Enter your parish or ministry").max(120),
    phone: z.string().trim().max(30).default(""),
    acknowledged: z.literal(true, { message: "Read and acknowledge the displayed privacy notice" }),
    noticeVersion: z.literal(registrationNotice.version),
  })
  .strict();
export const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters")
  .max(128, "Use at most 128 characters");
export const registrationSchema = profileSchema
  .extend({
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .strict()
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords must match",
    path: ["confirmPassword"],
  });

export function profileValues(form: FormData) {
  return {
    title: String(form.get("title") ?? ""),
    fullName: String(form.get("fullName") ?? ""),
    parish: String(form.get("parish") ?? ""),
    phone: String(form.get("phone") ?? ""),
    acknowledged: form.get("acknowledged") === "on",
    noticeVersion: registrationNotice.version,
  };
}
