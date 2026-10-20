import { z } from "zod";
import { canonicalIsbn } from "./isbn";

// Shared server-side validation. The database repeats these checks for direct RPCs.
export const newIsbnBookSchema = z.object({
  collectionId: z.string().uuid(),
  requestId: z.string().uuid(),
  isbn: z.string().transform(canonicalIsbn).refine((value): value is string => value !== null, "Invalid ISBN-10 or ISBN-13."),
  title: z.string().trim().min(1).max(300),
  authors: z.array(z.string().trim().min(1).max(160)).max(10),
  publisher: z.string().trim().max(200),
  language: z.string().trim().max(40),
  publishedDate: z.string().trim().max(80),
});
