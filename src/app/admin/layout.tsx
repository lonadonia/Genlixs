import type { Metadata } from "next";
import { AdminChrome } from "@/components/admin/admin-chrome";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Genlixs admin" } };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminChrome>{children}</AdminChrome>;
}
