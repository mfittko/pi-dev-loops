import { z } from "zod";

export const DebtFindingValidationStatus = z.enum([
  "pending",
  "validated",
  "rejected",
  "stale",
]);

export const DebtFindingRemediationShape = z.enum([
  "item",
  "epic",
  "defer",
  "watch_only",
  "dismissed",
]);

export const DebtFindingLocationSummary = z.strictObject({
  filePaths: z.array(z.string().min(1)).optional(),
  primaryFilePath: z.string().min(1).optional(),
});

export const DebtFindingSchema = z.strictObject({
  id: z.string().uuid(),
  signalIds: z.array(z.string().uuid()).min(1),
  validationStatus: DebtFindingValidationStatus,
  score: z.number().min(0).max(100).optional(),
  remediationShape: DebtFindingRemediationShape,
  title: z.string().min(1).max(200),
  description: z.string().min(1).optional(),
  locationSummary: DebtFindingLocationSummary.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
