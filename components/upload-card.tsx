import {
  UploadCardClient,
  type UploadCardPlan,
} from "@/components/upload-card-client";
import { listPlans } from "@/lib/server/plans";

/**
 * Server-side shell for the upload demo. Loads the plan list directly
 * via `listPlans()` (skipping the round-trip through /api/plans) and
 * hands the result to the client component. Keeping the initial fetch
 * on the server avoids React 19's `react-hooks/set-state-in-effect`
 * trap and means the page renders with plans already populated.
 *
 * If the data layer throws (e.g. Supabase down at request time), we
 * still render the client with an empty list rather than 500ing the
 * whole page -- the user can hit "Create demo plan" to recover.
 */
export async function UploadCard() {
  let initialPlans: UploadCardPlan[] = [];
  try {
    const rows = await listPlans(50);
    initialPlans = rows.map((p) => ({
      id: p.id,
      employer_name: p.employer_name,
      plan_name: p.plan_name,
      plan_year: p.plan_year,
      status: p.status,
      created_at: p.created_at,
    }));
  } catch (err) {
    console.error("[upload-card] failed to list plans:", err);
  }

  return <UploadCardClient initialPlans={initialPlans} />;
}
