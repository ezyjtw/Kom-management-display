import AdminClient from "./AdminClient";
import { isFeatureEnabled } from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  return <AdminClient scoringEnabled={await isFeatureEnabled("people.scoring")} />;
}
