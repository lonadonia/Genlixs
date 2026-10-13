export const cn = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

// Fixed UTC formatting keeps server and client output identical (no hydration drift).
const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const dateTimeFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});
const num = new Intl.NumberFormat("en-US");
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

export const fmtDate = (ms: number) => dateFmt.format(ms);
export const fmtDateTime = (ms: number) => `${dateTimeFmt.format(ms)} UTC`;
export const fmtNum = (n: number) => num.format(n);
export const fmtUsd = (n: number) => usd.format(n);
export const fmtCredits = (n: number) => `${num.format(n)} ${Math.abs(n) === 1 ? "credit" : "credits"}`;
export const fmtSigned = (n: number) => (n > 0 ? `+${num.format(n)}` : n < 0 ? `−${num.format(Math.abs(n))}` : "0");

export const fmtElapsed = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return m ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
};

export const fmtCountdown = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
