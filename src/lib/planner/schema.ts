import "@/lib/validation/zod-jitless";
import { z } from "zod";
import { SPEC_TOOL_SCHEMA, SpecSchema, type Spec } from "@/lib/match/schema";
import { PaletteColor } from "./palette";

export const PlanPieceSchema = z.object({
  index: z.number().int().min(0),
  spec: SpecSchema,
});
export const CollectionPlanSchema = z.object({
  palette: z.array(z.object({ name: z.string().trim().min(1).max(80), hex: z.string().regex(/^#[0-9a-f]{6}$/i) })).min(3).max(6),
  pieces: z.array(PlanPieceSchema).min(1).max(12),
});
export type CollectionPlan = z.infer<typeof CollectionPlanSchema>;
export type PlanPalette = PaletteColor;
export type PlanSpec = Spec;

export const PLAN_TOOL_SCHEMA = {
  type: "object",
  properties: {
    palette: { type: "array", minItems: 3, maxItems: 6, items: { type: "object", properties: { name: { type: "string" }, hex: { type: "string" } }, required: ["name", "hex"] } },
    pieces: { type: "array", items: { type: "object", properties: { index: { type: "integer" }, spec: SPEC_TOOL_SCHEMA }, required: ["index", "spec"] } },
  },
  required: ["palette", "pieces"],
} as const;
