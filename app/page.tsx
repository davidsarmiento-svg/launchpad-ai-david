import { OnboardingHome } from "@/components/onboarding-home";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-muted/30">
      <OnboardingHome />
    </div>
  );
}
