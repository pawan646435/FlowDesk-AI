import type { OrganizationRole } from "@prisma/client";
import type { DefaultSession } from "next-auth";

// MULTI_TENANCY_DESIGN.md §2.4 — proper module augmentation replacing the previous
// bare `as string` casts on session.user.id, extended for organizationId/role per §9.6.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      organizationId: string | null;
      role: OrganizationRole | null;
    } & DefaultSession["user"];
  }

  interface User {
    organizationId?: string | null;
    role?: OrganizationRole | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    organizationId: string | null;
    role: OrganizationRole | null;
  }
}
