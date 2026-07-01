// W0.3 — Fact-row contract.
// Compute pipeline rejects rows that don't satisfy this shape.
// Keep aligned with supabase/migrations/0001_init.sql + 0007_facts_lineage.sql.

import { z } from "zod";

export const SourceRowRef = z.object({
  table: z.string().min(1),
  pk: z.union([z.string(), z.number()]),
});

export const FactRow = z.object({
  id: z.string().min(1),
  metric: z.string().min(1),
  dims: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
  value: z.number().finite().nullable(),
  value_text: z.string().nullable().optional(),
  time_window: z.string().nullable().optional(),
  method: z.enum(["sql", "ml", "rule"]).transform((m) => `${m}` as const),
  sample_n: z.number().int().nonnegative().nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  data_health: z.number().min(0).max(1).nullable().optional(),
  formula_id: z.string().min(1),
  unstable: z.boolean().default(false),
  source_rows: z.array(SourceRowRef).default([]),
  computed_at: z.string().datetime().optional(),
});

export type FactRow = z.infer<typeof FactRow>;

export function validateFact(row: unknown): FactRow {
  return FactRow.parse(row);
}

export function safeValidateFact(row: unknown):
  | { ok: true; row: FactRow }
  | { ok: false; errors: z.ZodIssue[] } {
  const parsed = FactRow.safeParse(row);
  return parsed.success
    ? { ok: true, row: parsed.data }
    : { ok: false, errors: parsed.error.issues };
}
