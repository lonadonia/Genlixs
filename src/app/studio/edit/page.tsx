import { redirect } from "next/navigation";
import { imageEditRedirect } from "@/lib/studio-routes";

/** Image editing now lives inside the Image studio (Generate / Edit); earlier links land there with Edit selected. */
export default async function EditStudioPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(imageEditRedirect(await searchParams));
}
