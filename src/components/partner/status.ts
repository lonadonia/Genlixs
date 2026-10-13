import type { Tone } from "@/components/ui/badge";
import type { Commission } from "@/lib/admin-data";

export const COMMISSION_STATUS: Record<Commission["status"], { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "neutral" },
  available: { label: "Available", tone: "success" },
  reserved: { label: "Reserved", tone: "info" },
  paid: { label: "Paid", tone: "violet" },
  held: { label: "On hold", tone: "warning" },
  reversed: { label: "Reversed", tone: "error" },
};
