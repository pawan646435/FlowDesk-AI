import NextAuth from "next-auth";
import authConfig from "./auth.config";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const { nextUrl } = req;

  const isDashboard = nextUrl.pathname.startsWith("/dashboard");
  const isTickets = nextUrl.pathname.startsWith("/tickets");
  const isSettings = nextUrl.pathname.startsWith("/settings");

  if (isDashboard || isTickets || isSettings) {
    if (!isLoggedIn) {
      // Redirect to login page
      return Response.redirect(new URL("/login", nextUrl));
    }
  }

  // No auto-redirect-to-/dashboard for /login when isLoggedIn is true: middleware can only
  // check JWT presence (req.auth), never whether the token's organizationId/role still
  // match the DB — it can't reach Prisma from the edge runtime this middleware runs in.
  // A removed/switched user's still-well-formed-but-stale JWT would otherwise make this
  // rule bounce them straight back to /dashboard, undoing getVerifiedSession()'s own
  // /login redirect and creating an infinite loop (TEAM_REMOVAL_DESIGN.md §1 gap, found
  // during manual staleness testing). login/page.tsx does the equivalent redirect itself,
  // DB-aware, via getVerifiedSessionOrNull — see that file.

  return;
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
