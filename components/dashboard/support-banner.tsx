import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";

export function SupportBanner() {
  return (
    <section
      className="flex flex-col gap-4 rounded-[1.25rem] border border-[#E0E7FF] bg-[#EEF2FF] px-6 py-5 sm:flex-row sm:items-center sm:justify-between"
      aria-label="Support"
    >
      <div className="flex gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white shadow-sm">
          <Sparkles className="size-5 text-[#4F46E5]" aria-hidden />
        </div>
        <div>
          <h2 className="text-base font-semibold text-[#07133F]">
            We&apos;re here to help
          </h2>
          <p className="mt-0.5 text-sm text-[#64748B]">
            Need support or have a question? Our team is ready to help.
          </p>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        className="shrink-0 border-[#E5E7EB] bg-white text-[#07133F] hover:bg-white/90"
      >
        Contact us
      </Button>
    </section>
  );
}
