import "@/lib/validation/zod-jitless";
import { z } from "zod";
import { FIBERS, SEASONS, STRETCHES, STRUCTURES, USES } from "@/lib/catalog/params";

export const AUDIENCES = ["women", "men", "kids", "unisex", "home", "workwear"] as const;
export const STYLES = ["minimal", "innovative", "sporty", "classic", "luxurious", "casual", "romantic", "streetwear", "eco", "technical"] as const;
export const BRAND_FEELS = ["premium", "accessible", "sustainable", "bold", "heritage", "playful", "performance"] as const;

/** Answers of the 5-step wizard (docs/06-ai-matching.md §1). */
export const WizardInputSchema = z.object({
  audience: z.enum(AUDIENCES).nullable().default(null),
  audienceText: z.string().trim().max(200).default(""),
  styles: z.array(z.enum(STYLES)).max(3).default([]),
  brand: z.array(z.enum(BRAND_FEELS)).max(3).default([]),
  priceTarget: z.number().positive().max(1000).nullable().default(null),
  description: z.string().trim().min(10, "descriptionMin").max(600, "descriptionMax"),
  requiredM: z.number().positive().max(100000).nullable().default(null),
});
export type WizardInput = z.infer<typeof WizardInputSchema>;

const feelScore = z.number().min(0).max(10);

/** The technical specification extracted from a brief (the JSON the model must return). */
export const SpecSchema = z.object({
  construction: z.enum(["knit", "woven", "nonwoven"]).nullable().default(null),
  structures: z.array(z.enum(STRUCTURES)).default([]),
  fibers_preferred: z.array(z.enum(FIBERS)).default([]),
  fibers_avoid: z.array(z.enum(FIBERS)).default([]),
  gsm_min: z.number().min(20).max(1200).nullable().default(null),
  gsm_max: z.number().min(20).max(1200).nullable().default(null),
  stretch: z.enum(STRETCHES).nullable().default(null),
  seasons: z.array(z.enum(SEASONS)).default([]),
  uses: z.array(z.enum(USES)).default([]),
  feel: z.object({ softness: feelScore.optional(), drape: feelScore.optional(), sheen: feelScore.optional(), breathability: feelScore.optional() }).default({}),
  colors: z.array(z.object({ name: z.string(), hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/) })).default([]),
  budget_max_per_m: z.number().positive().nullable().default(null),
  query_text: z.string().default(""),
});
export type Spec = z.infer<typeof SpecSchema>;

export const emptySpec = (): Spec => SpecSchema.parse({});

/** JSON Schema of the `submit_spec` tool (same shape as SpecSchema), for the model's forced tool call. */
export const SPEC_TOOL_SCHEMA = {
  type: "object",
  properties: {
    construction: { type: ["string", "null"], enum: ["knit", "woven", "nonwoven", null] },
    structures: { type: "array", items: { type: "string", enum: [...STRUCTURES] } },
    fibers_preferred: { type: "array", items: { type: "string", enum: [...FIBERS] } },
    fibers_avoid: { type: "array", items: { type: "string", enum: [...FIBERS] } },
    gsm_min: { type: ["number", "null"] },
    gsm_max: { type: ["number", "null"] },
    stretch: { type: ["string", "null"], enum: [...STRETCHES, null] },
    seasons: { type: "array", items: { type: "string", enum: [...SEASONS] } },
    uses: { type: "array", items: { type: "string", enum: [...USES] } },
    feel: {
      type: "object",
      properties: { softness: { type: "number" }, drape: { type: "number" }, sheen: { type: "number" }, breathability: { type: "number" } },
    },
    colors: { type: "array", items: { type: "object", properties: { name: { type: "string" }, hex: { type: "string" } }, required: ["name", "hex"] } },
    budget_max_per_m: { type: ["number", "null"] },
    query_text: { type: "string" },
  },
  required: ["construction", "structures", "fibers_preferred", "fibers_avoid", "gsm_min", "gsm_max", "stretch", "seasons", "uses", "query_text"],
} as const;

/** A fabric color that is in stock, as returned by the SQL function match_candidates(). */
export interface Candidate {
  color_id: string;
  fabric_id: string;
  slug: string;
  sku: string;
  name: { fr?: string; en?: string; ar?: string };
  structure: string;
  construction: string;
  composition: { fiber: string; pct: number }[];
  gsm: number;
  width_cm: number;
  stretch: string;
  uses: string[];
  seasons: string[];
  moq_m: number | string;
  feel: { softness?: number | null; drape?: number | null; stretch?: number | null; sheen?: number | null; breathability?: number | null } | null;
  available_m: number | string;
  price: number | string | null;
  text_sim: number;
  hex: string;
  lab: number[] | null;
  color_code: string;
  color_name: { fr?: string; en?: string; ar?: string };
  image_path: string | null;
}

export interface Components {
  semantic: number;
  gsm: number | null;
  fiber: number | null;
  stretch: number | null;
  use_season: number | null;
  structure: number | null;
  feel: number | null;
  color: number | null;
  budget: number;
}
export interface ScoredCandidate {
  candidate: Candidate;
  score: number;
  pct: number;
  components: Components;
}
