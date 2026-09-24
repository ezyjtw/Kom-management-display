import { requireFeature } from "@/lib/feature-gate";

export const dynamic = "force-dynamic";

export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireFeature("module.usdc_ramp");
  return <>{children}</>;
}
