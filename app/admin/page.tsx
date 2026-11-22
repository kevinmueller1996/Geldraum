import { headers } from "next/headers";
import { backendOrigin, needsCloudflareBackendProxy } from "../vercel/proxy-api";
import type { Metadata } from "next";
import { AdminDashboard } from "./AdminDashboard";
import { AdminLogin } from "./AdminLogin";
import { adminCookie, isAdminAuthenticated } from "./admin-auth";
import { loadAdminData, type AdminData } from "./admin-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Njora Admin – Testerübersicht", robots: { index: false, follow: false } };

export default async function AdminPage() {
  if (needsCloudflareBackendProxy()) {
    const cookie = adminCookie(await headers());
    if (!cookie) return <AdminLogin />;
    const response = await fetch(new URL("/api/admin/testers", backendOrigin()), {
      headers: { cookie }, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(10_000)
    });
    if (response.status === 401) return <AdminLogin />;
    if (!response.ok) throw new Error("Die Testerübersicht konnte nicht geladen werden.");
    return <AdminDashboard data={await response.json() as AdminData} />;
  }
  if (!(await isAdminAuthenticated())) return <AdminLogin />;
  const data = await loadAdminData();
  return <AdminDashboard data={data} />;
}
