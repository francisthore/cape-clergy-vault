import { z } from "zod";

export const chatMessageSchema = z
  .string()
  .trim()
  .min(1, "Enter a message")
  .max(4000, "Keep messages under 4,000 characters");
