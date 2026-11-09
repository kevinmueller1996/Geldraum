import type { Metadata } from "next";
import { AdminDashboard } from "./AdminDashboard";
import { AdminLogin } from "./AdminLogin";
import { isAdminAuthenticated } from "./admin-auth";
import { loadAdminData } from "./admin-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Njora Admin – Testerübersicht", robots: { index: false, follow: false } };

export default async function AdminPage() {
  if (!(await isAdminAuthenticated())) return <AdminLogin />;
  const data = await loadAdminData();
  return <AdminDashboard data={data} />;
}
