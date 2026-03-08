import { Suspense } from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-options";
import { dashboardService } from "@/modules/dashboard/services/dashboard-service";
import { DashboardClient } from "./DashboardClient";

/**
 * Server component: fetches initial data on the server before render.
 * Auth is enforced server-side — unauthenticated users are redirected.
 * All data loading is delegated to the dashboard aggregation service.
 * Client component handles filters, refresh, and interactivity.
 */
export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  const user = session.user as { id: string; role: string; employeeId?: string; team?: string };

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      }
    >
      <DashboardDataLoader user={user} />
    </Suspense>
  );
}

async function DashboardDataLoader({ user }: { user: { id: string; role: string; employeeId?: string; team?: string } }) {
  const { employees, opsData } = await dashboardService.loadDashboardData(user, "month");

  return (
    <DashboardClient
      initialEmployees={employees}
      initialOpsData={opsData}
      userRole={user.role}
    />
  );
}
