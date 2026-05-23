"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, HelpCircle } from "lucide-react";
import { useEffect, useState } from "react";

import type { SidebarNavItem } from "@/lib/dashboard-modules";
import { cn } from "@/lib/utils";

export function AppSidebar({
  navItems,
  open = false,
  onClose,
}: {
  navItems: SidebarNavItem[];
  open?: boolean;
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const [hash, setHash] = useState("");

  useEffect(() => {
    const sync = () => setHash(window.location.hash);
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  function isActive(href: string, id: string): boolean {
    if (id === "dashboard") return pathname === "/" && hash !== "#active-plans";
    if (id === "onboarding-home") {
      return pathname === "/" && hash === "#active-plans";
    }
    if (href === "/") return false;
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-[#07133F]/40 md:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col bg-gradient-to-b from-[#4F46E5] to-[#4338CA] text-white transition-transform duration-200 md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
      >
      <div className="px-6 pt-7 pb-6">
        <Link href="/" className="text-xl font-bold tracking-tight text-white">
          ForUsAll
        </Link>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3" aria-label="Main">
        {navItems.map((item) => {
          const active = isActive(item.href, item.id);
          const Icon = item.icon;

          return (
            <Link
              key={item.id}
              href={item.href}
              onClick={onClose}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-white/20 text-white shadow-sm"
                  : "text-white/85 hover:bg-white/10 hover:text-white",
              )}
            >
              <Icon className="size-[1.125rem] shrink-0 opacity-90" aria-hidden />
              <span className="flex-1 truncate">{item.label}</span>
              {item.badge != null && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-white/25 px-1.5 text-[10px] font-semibold">
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-white/15 px-3 py-4">
        <Link
          href="#"
          className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-white/85 transition-colors hover:bg-white/10 hover:text-white"
        >
          <HelpCircle className="size-[1.125rem]" aria-hidden />
          Help Center
        </Link>

        <button
          type="button"
          className="mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors hover:bg-white/10"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/20 text-xs font-semibold">
            AC
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">Alex Carter</span>
            <span className="block truncate text-xs text-white/70">
              Plan Sponsor
            </span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-white/60" aria-hidden />
        </button>
      </div>
    </aside>
    </>
  );
}
