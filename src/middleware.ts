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

  if (nextUrl.pathname === "/login") {
    // A present `error` param means a sign-in attempt just failed (e.g. the §9.4
    // AccessDenied rejection) for whatever account was used in that attempt. Redirecting
    // to /dashboard here would silently mask that rejection behind an unrelated, still-
    // valid session left over from a previous account — let /login render the error.
    if (isLoggedIn && !nextUrl.searchParams.has("error")) {
      // Redirect to dashboard page if already logged in
      return Response.redirect(new URL("/dashboard", nextUrl));
    }
  }

  return;
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
