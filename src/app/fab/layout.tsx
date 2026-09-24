import { requireFeature } from "@/lib/feature-gate";

export const dynamic = "force-dynamic";

/** FAB ICS repo (spec §12 TASK-FAB): hidden while module.fab is off. */
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireFeature("module.fab");
  return <>{children}</>;
}
