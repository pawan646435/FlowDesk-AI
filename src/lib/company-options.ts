// Shared display labels for CompanyIndustry/CompanySize enum values — used by both the
// create-organization form (client) and the read-only Org Profile section on /settings
// (server), so the label text only lives in one place.

export const INDUSTRY_LABELS: Record<string, string> = {
  SOFTWARE_TECH: "Software & Technology",
  ECOMMERCE_RETAIL: "E-commerce & Retail",
  FINANCE_BANKING: "Finance & Banking",
  HEALTHCARE: "Healthcare",
  EDUCATION: "Education",
  HOSPITALITY_TRAVEL: "Hospitality & Travel",
  MEDIA_ENTERTAINMENT: "Media & Entertainment",
  PROFESSIONAL_SERVICES: "Professional Services",
  OTHER: "Other",
};

export const SIZE_LABELS: Record<string, string> = {
  SIZE_1_10: "1–10 employees",
  SIZE_11_50: "11–50 employees",
  SIZE_51_200: "51–200 employees",
  SIZE_201_1000: "201–1,000 employees",
  SIZE_1000_PLUS: "1,000+ employees",
};

export const INDUSTRY_OPTIONS = Object.entries(INDUSTRY_LABELS).map(([value, label]) => ({ value, label }));
export const SIZE_OPTIONS = Object.entries(SIZE_LABELS).map(([value, label]) => ({ value, label }));
