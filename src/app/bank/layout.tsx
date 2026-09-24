import { requireFeature } from "@/lib/feature-gate";

export const dynamic = "force-dynamic";

/** Bank repo (spec §12 TASK-BANK): hidden while module.bank is off. */
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireFeature("module.bank");
  return <>{children}</>;
}
