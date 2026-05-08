import { z } from "zod";

// Stage output schemas. Intentionally loose for v0 — tighten as the
// rogue-one stage implementations stabilize. Keep required fields minimal
// and use `notes` / `extra` for free-form content the UI can render but
// doesn't depend on structurally.

export const ResearchOutput = z.object({
  brief: z.string(), // markdown
  citations: z
    .array(
      z.object({
        url: z.string(),
        title: z.string().optional(),
      }),
    )
    .default([]),
  // TODO: tighten — what does rogue-one actually want to surface here?
  notes: z.string().optional(),
});
export type ResearchOutput = z.infer<typeof ResearchOutput>;

export const PlanStep = z.object({
  title: z.string(),
  description: z.string(), // markdown
  files: z.array(z.string()).default([]),
  notes: z.string().optional(),
});

export const PlanOutput = z.object({
  summary: z.string(),
  steps: z.array(PlanStep),
  // TODO: risks, open questions, success criteria
});
export type PlanOutput = z.infer<typeof PlanOutput>;

export const PlanReviewOutput = z.object({
  critique: z.string(), // markdown
  revisedPlan: PlanOutput.optional(),
  decision: z.enum(["accept", "revise"]),
});
export type PlanReviewOutput = z.infer<typeof PlanReviewOutput>;

export const CodeFileChange = z.object({
  path: z.string(),
  status: z.enum(["added", "modified", "deleted", "renamed"]),
  oldPath: z.string().optional(),
  diff: z.string(), // unified diff
});

export const CodeOutput = z.object({
  files: z.array(CodeFileChange),
  summary: z.string().optional(),
});
export type CodeOutput = z.infer<typeof CodeOutput>;

export const CodeReviewComment = z.object({
  path: z.string(),
  line: z.number().int().nonnegative(),
  severity: z.enum(["info", "suggestion", "issue", "blocker"]),
  message: z.string(),
});

export const CodeReviewOutput = z.object({
  comments: z.array(CodeReviewComment),
  summary: z.string(),
  decision: z.enum(["accept", "revise"]),
});
export type CodeReviewOutput = z.infer<typeof CodeReviewOutput>;

export const PrOutput = z.object({
  title: z.string(),
  body: z.string(), // markdown
  url: z.string().optional(), // populated after the PR is opened
  number: z.number().int().optional(),
});
export type PrOutput = z.infer<typeof PrOutput>;
