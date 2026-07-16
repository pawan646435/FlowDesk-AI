// ORG_ONBOARDING_DESIGN.md §1.6 open decision, resolved — cap at 20 teammate invites
// per submission, enforced client-side (the array itself is capped before submission;
// validation.ts re-validates server-side too, since client-side caps are only a UX nicety).
export const MAX_TEAMMATE_INVITES = 20;
