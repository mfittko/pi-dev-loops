import { z } from "zod";

// ---------------------------------------------------------------------------
// AC/DoD matrix item — one row in the refinement coverage matrix
// ---------------------------------------------------------------------------

export const AC_DOD_ITEM_TYPE = Object.freeze({
  AC: "AC",
  DOD: "DoD",
  NON_GOAL: "Non-goal",
});

export const AC_DOD_ITEM_STATUS = Object.freeze({
  MET: "Met",
  PARTIAL: "Partial",
  UNMET: "Unmet",
  UNVERIFIED: "Unverified",
});

/**
 * A single row in the AC/DoD coverage matrix.
 * Matches the refiner persona's required table output shape.
 */
export const AcDodMatrixItemSchema = z.strictObject({
  /** Exact item text from the source issue/plan/spec */
  item: z.string().trim().min(1),
  /** Type classification */
  type: z.enum(Object.values(AC_DOD_ITEM_TYPE)),
  /** Verification status */
  status: z.enum(Object.values(AC_DOD_ITEM_STATUS)),
  /** Reference to supporting evidence (file, test, doc path, or URL) */
  evidence: z.string(),
  /** Additional context or caveats */
  notes: z.string(),
});

/**
 * The full AC/DoD/Non-goal coverage matrix.
 * Emitted by the refiner during issue refinement, consumed by implementation
 * agents via the handoff envelope as a structured contract.
 */
export const AcDodMatrixSchema = z.strictObject({
  /** Schema identifier for dispatch and validation */
  schema: z.literal("ac-dod-matrix/v1"),
  /** Ordered list of matrix items */
  items: z.array(AcDodMatrixItemSchema).min(1),
  /** Source reference (issue URL, plan-doc path, etc.) */
  source: z.string().trim().min(1).optional(),
  /** ISO 8601 timestamp of matrix generation */
  generatedAt: z.string().datetime(),
  /**
   * True when every item has status "Met" — the contract is fully satisfied.
   * Implementation agents use this to gate merge-readiness.
   */
  isComplete: z.boolean(),
}).refine(
  (data) => isMatrixComplete(data) === data.isComplete,
  {
    message: "isComplete must be true when (and only when) every item has status 'Met'",
    path: ["isComplete"],
  }
);

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a matrix is fully satisfied (all items Met).
 * Pure function — does not require a parsed Zod result.
 */
export function isMatrixComplete(matrix) {
  if (!matrix || !Array.isArray(matrix.items) || matrix.items.length === 0) {
    return false;
  }
  return matrix.items.every((item) => item.status === AC_DOD_ITEM_STATUS.MET);
}

/**
 * Collect all items that are not "Met" — the outstanding work contract.
 */
export function outstandingItems(matrix) {
  if (!matrix || !Array.isArray(matrix.items)) {
    return [];
  }
  return matrix.items.filter((item) => item.status !== AC_DOD_ITEM_STATUS.MET);
}

/**
 * Validate raw data against the AC/DoD matrix schema.
 * Returns a Zod safeParse result.
 */
export function validateAcDodMatrix(data) {
  return AcDodMatrixSchema.safeParse(data);
}
