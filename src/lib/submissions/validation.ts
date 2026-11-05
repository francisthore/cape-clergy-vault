import { z } from "zod";
export const categories = [
  "Sermon / Homily",
  "Research paper",
  "Liturgy & worship",
  "Pastoral care",
  "Biblical studies",
  "Church history",
  "Ethics & society",
  "Idea / Proposal",
  "General",
] as const;
export const draftSchema = z
  .object({
    action: z.literal("save"),
    id: z.string().uuid().optional(),
    version: z.number().int().min(0),
    kind: z.enum(["document", "idea"]),
    title: z.string().trim().min(1).max(200),
    category: z.enum(categories),
    abstract: z.string().max(20000),
    keywords: z.array(z.string().trim().min(1).max(60)).max(20),
    confidential: z.boolean(),
  })
  .strict();
export const transitionSchema = z
  .object({
    action: z.enum(["submit", "amend", "exclude"]),
    id: z.string().uuid(),
    version: z.number().int().positive(),
  })
  .strict();
export const querySchema = z
  .object({
    id: z.string().uuid().optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    search: z.string().trim().max(120).default(""),
    category: z.union([z.literal(""), z.enum(categories)]).default(""),
    keyword: z.string().trim().max(60).default(""),
    status: z.enum(["", "draft", "submitted", "under_review", "accepted", "returned"]).default(""),
  })
  .strict();
export type SubmissionRow = {
  id: string;
  kind: "document" | "idea";
  title: string;
  category: string;
  abstract: string;
  keywords: string[];
  confidential: boolean;
  status: string;
  version: number;
  revision: number;
  created_at: string;
  submitted_at: string | null;
  document_count: number;
};
