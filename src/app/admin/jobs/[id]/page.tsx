import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JobDetail } from "@/components/admin/job-detail";
import { ADMIN_JOBS } from "@/lib/admin-data";

export function generateStaticParams() {
  return ADMIN_JOBS.map((j) => ({ id: j.id }));
}

export async function generateMetadata({ params }: PageProps<"/admin/jobs/[id]">): Promise<Metadata> {
  const { id } = await params;
  return { title: `Job ${id}` };
}

export default async function AdminJobPage({ params, searchParams }: PageProps<"/admin/jobs/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const job = ADMIN_JOBS.find((j) => j.id === id);
  if (!job) notFound();
  const back = typeof sp.back === "string" && sp.back.length < 300 ? sp.back : null;
  return <JobDetail job={job} back={back} />;
}
