import "@/lib/validation/zod-jitless";
import { z } from "zod";

export const contactSchema = z.object({
  name: z.string().trim().min(2, "nameMin").max(120, "tooLong"),
  company: z.string().trim().max(160, "tooLong"),
  email: z.string().trim().min(1, "required").pipe(z.email("email")),
  phone: z
    .string()
    .trim()
    .max(40, "phone")
    .refine((v) => v === "" || /^\+?[0-9 ().-]{6,40}$/.test(v), "phone"),
  message: z.string().trim().min(10, "messageMin").max(4000, "tooLong"),
  consent: z.literal(true, { error: "consentRequired" }),
  locale: z.enum(["fr", "en", "ar"]),
});

export type ContactInput = z.infer<typeof contactSchema>;
