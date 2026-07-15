import { z } from "zod";

export const createTicketSchema = z.object({
  title: z
    .string()
    .min(3, "Title must be at least 3 characters long")
    .max(100, "Title cannot exceed 100 characters"),
  description: z
    .string()
    .min(10, "Description must be at least 10 characters long"),
  isHighPriority: z.boolean().optional(),
});

export const updateTicketStatusSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED"]),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type UpdateTicketStatusInput = z.infer<typeof updateTicketStatusSchema>;

// ORG_ONBOARDING_DESIGN.md §1.2/§1.3 — required, no "prefer not to say" escape hatch
// (§1.6 open decision, resolved).
export const companyIndustryValues = [
  "SOFTWARE_TECH",
  "ECOMMERCE_RETAIL",
  "FINANCE_BANKING",
  "HEALTHCARE",
  "EDUCATION",
  "HOSPITALITY_TRAVEL",
  "MEDIA_ENTERTAINMENT",
  "PROFESSIONAL_SERVICES",
  "OTHER",
] as const;

export const companySizeValues = [
  "SIZE_1_10",
  "SIZE_11_50",
  "SIZE_51_200",
  "SIZE_201_1000",
  "SIZE_1000_PLUS",
] as const;

// ORG_ONBOARDING_DESIGN.md §1.6 open decision, resolved — cap at 20 teammate invites
// per submission, enforced client-side (the array itself is capped before submission;
// this schema re-validates server-side too, since client-side caps are only a UX nicety).
export const MAX_TEAMMATE_INVITES = 20;

export const createOrganizationSchema = z.object({
  orgName: z
    .string()
    .min(2, "Organization name must be at least 2 characters long")
    .max(100, "Organization name cannot exceed 100 characters"),
  email: z.string().email("Enter a valid email address"),
  industry: z.enum(companyIndustryValues, { message: "Select an industry" }),
  size: z.enum(companySizeValues, { message: "Select a company size" }),
  website: z.union([z.literal(""), z.string().url("Enter a valid URL")]).optional(),
  teammateEmails: z
    .array(z.string().email("Enter a valid email address"))
    .max(MAX_TEAMMATE_INVITES, `You can invite up to ${MAX_TEAMMATE_INVITES} teammates at once`)
    .optional(),
});

export const sendInviteSchema = z.object({
  email: z.string().email("Enter a valid email address"),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type SendInviteInput = z.infer<typeof sendInviteSchema>;

// Empty string means "not configured" (cleared), so it's allowed alongside a valid URL.
const optionalUrl = z.union([z.literal(""), z.string().url("Enter a valid URL")]);

export const webhookConfigSchema = z.object({
  newTicketUrl: optionalUrl,
  escalationUrl: optionalUrl,
  negativeSentimentUrl: optionalUrl,
  resolutionUrl: optionalUrl,
  slaBreachUrl: optionalUrl,
});

export type WebhookConfigFormInput = z.infer<typeof webhookConfigSchema>;

// JOIN_REQUEST_DESIGN.md §3.2/§5 — /onboarding's request form.
export const joinRequestSchema = z.object({
  ownerEmail: z.string().email("Enter a valid email address"),
});

export type JoinRequestInput = z.infer<typeof joinRequestSchema>;
