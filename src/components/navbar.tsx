"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { LayoutDashboard, Ticket, LogOut, User, Menu, X, BookOpen, Settings } from "lucide-react";
import { useState } from "react";
import type { Session } from "next-auth";

interface NavbarProps {
  // Passed down from the root layout's DB-verified getVerifiedSession() call, not read
  // via next-auth/react's useSession() here — that hook only decodes the raw JWT cookie
  // client-side, with no DB check, so it kept rendering a removed/left user as logged in
  // even after their next page load correctly redirected the actual page content to
  // /login. See layout.tsx for the full reasoning.
  session: Session | null;
}

export function Navbar({ session }: NavbarProps) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  if (!session) return null;

  const navItems = [
    { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { name: "Tickets", href: "/tickets", icon: Ticket },
    { name: "Knowledge Base", href: "/dashboard/knowledge-base", icon: BookOpen },
    { name: "Settings", href: "/settings", icon: Settings },
  ];

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-border/40 glass backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 hover:opacity-90 transition-opacity">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md glow-purple">
              <Ticket className="h-5 w-5" />
            </div>
            <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-primary to-indigo-500 bg-clip-text text-transparent">
              FlowDesk AI
            </span>
          </Link>

          {/* Desktop Nav Links */}
          <div className="hidden md:flex items-center space-x-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.name}
                </Link>
              );
            })}
          </div>

          {/* Profile & Logout */}
          <div className="hidden md:flex items-center gap-4">
            <div className="flex items-center gap-2 border-r border-border/40 pr-4">
              {session.user?.image ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={session.user.image}
                  alt={session.user.name || "User Avatar"}
                  className="h-8 w-8 rounded-full ring-2 ring-primary/20"
                />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                  <User className="h-4 w-4" />
                </div>
              )}
              <div className="flex flex-col">
                <span className="text-sm font-semibold leading-none text-foreground">
                  {session.user?.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {session.user?.email}
                </span>
              </div>
            </div>

            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </button>
          </div>

          {/* Mobile menu button */}
          <div className="flex md:hidden">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none"
            >
              {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-border/40 bg-background/95 backdrop-blur-md px-2 pt-2 pb-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-base font-medium transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                }`}
              >
                <Icon className="h-5 w-5" />
                {item.name}
              </Link>
            );
          })}
          
          <div className="border-t border-border/40 pt-4 mt-4 px-3 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              {session.user?.image ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={session.user.image}
                  alt={session.user.name || "User Avatar"}
                  className="h-10 w-10 rounded-full"
                />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                  <User className="h-5 w-5" />
                </div>
              )}
              <div className="flex flex-col">
                <span className="text-base font-semibold leading-none text-foreground">
                  {session.user?.name}
                </span>
                <span className="text-sm text-muted-foreground">
                  {session.user?.email}
                </span>
              </div>
            </div>
            
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-base font-medium text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
            >
              <LogOut className="h-5 w-5" />
              Sign Out
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}
