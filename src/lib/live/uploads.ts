"use client";

import { api, ApiClientError } from "./api";
import { browserClient } from "@/lib/supabase/client";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/config";

/**
 * Reference uploads (§16.2): intent → upload to the one authorized path with the customer's own session → server
 * verification from the bytes. Files over 6 MB use Supabase's resumable (TUS) endpoint in 6 MB chunks with retries
 * and progress; smaller files use a single upload. Storage stays private; nothing is public at any point.
 */
export type UploadedAsset = {
  assetId: string;
  name: string;
  mime: string;
  kind: "image" | "video" | "audio";
  bytes: number;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
};

const CHUNK = 6 * 1024 * 1024;
const MAX: Record<string, number> = { image: 10 * 1024 * 1024, video: 50 * 1024 * 1024, audio: 15 * 1024 * 1024 };

/** Browsers name some types differently; the server accepts one canonical name per type. */
export function canonicalMime(file: File): string | null {
  const t = (file.type || "").toLowerCase();
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (t === "image/png" || t === "image/jpeg" || t === "image/webp") return t;
  if (t === "image/jpg") return "image/jpeg";
  if (t === "video/mp4" || (!t && ext === "mp4")) return "video/mp4";
  if (t === "video/quicktime" || (!t && ext === "mov")) return "video/quicktime";
  if (t === "audio/mpeg" || t === "audio/mp3" || (!t && ext === "mp3")) return "audio/mpeg";
  if (t === "audio/wav" || t === "audio/x-wav" || t === "audio/wave" || t === "audio/vnd.wave" || (!t && ext === "wav")) return "audio/wav";
  if (t === "audio/mp4" || t === "audio/x-m4a" || t === "audio/m4a" || (!t && ext === "m4a")) return "audio/mp4";
  return null;
}

export const kindOf = (mime: string) => mime.split("/")[0] as "image" | "video" | "audio";

/** Local check before any network: type allowed for the slot and size within the type's limit. */
export function precheck(file: File, accepted: string[] | undefined, maxBytes?: number): { mime: string } | { error: string } {
  const mime = canonicalMime(file);
  if (!mime || (accepted && !accepted.includes(mime))) {
    const names = (accepted ?? []).map((m) => m.split("/")[1].replace("quicktime", "MOV").replace("mpeg", "MP3").replace("mp4", m.startsWith("audio") ? "M4A" : "MP4").toUpperCase());
    return { error: `${file.name}: use ${names.length ? names.join(", ") : "a supported file"}.` };
  }
  const limit = Math.min(maxBytes ?? Infinity, MAX[kindOf(mime)] ?? MAX.image);
  if (file.size > limit) return { error: `${file.name} is larger than ${Math.round(limit / 1024 / 1024)} MB.` };
  if (file.size === 0) return { error: `${file.name} is empty.` };
  return { mime };
}

export class UploadAborted extends Error {}

async function tusUpload(bucket: string, path: string, file: File, mime: string, onProgress: (f: number) => void, signal: AbortSignal) {
  const { data } = await browserClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiClientError("UNAUTHENTICATED", "Sign in again to upload.", 401);
  const endpoint = `${SUPABASE_URL.replace(/\/+$/, "")}/storage/v1/upload/resumable`;
  const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  const metadata = Object.entries({ bucketName: bucket, objectName: path, contentType: mime, cacheControl: "3600" })
    .map(([k, v]) => `${k} ${b64(v)}`)
    .join(",");
  const base = { authorization: `Bearer ${token}`, apikey: SUPABASE_PUBLISHABLE_KEY, "tus-resumable": "1.0.0" };
  const created = await fetch(endpoint, {
    method: "POST",
    headers: { ...base, "upload-length": String(file.size), "upload-metadata": metadata, "x-upsert": "false" },
    signal,
  });
  if (created.status !== 201) throw new Error(`create ${created.status}`);
  const location = new URL(created.headers.get("location") ?? "", endpoint).toString();
  const head = async () => {
    const r = await fetch(location, { method: "HEAD", headers: base, signal });
    const v = Number(r.headers.get("upload-offset"));
    if (!r.ok || !Number.isFinite(v)) throw new Error(`head ${r.status}`);
    return v;
  };
  let offset = 0;
  let failures = 0;
  while (offset < file.size) {
    if (signal.aborted) throw new UploadAborted();
    try {
      const r = await fetch(location, {
        method: "PATCH",
        headers: { ...base, "upload-offset": String(offset), "content-type": "application/offset+octet-stream" },
        body: file.slice(offset, Math.min(offset + CHUNK, file.size)),
        signal,
      });
      if (r.status === 204) {
        offset = Number(r.headers.get("upload-offset")) || Math.min(offset + CHUNK, file.size);
        failures = 0;
      } else if (r.status === 409 || r.status === 412) {
        offset = await head();
      } else {
        throw new Error(`patch ${r.status}`);
      }
    } catch (e) {
      if (signal.aborted) throw new UploadAborted();
      if (++failures > 4) throw e;
      await new Promise((res) => setTimeout(res, 800 * failures));
      offset = await head().catch(() => offset);
    }
    onProgress(offset / file.size);
  }
}

/** Uploads one file and returns the verified asset. Throws ApiClientError with a customer-readable message. */
export async function uploadReference(file: File, mime: string, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<UploadedAsset> {
  const intent = await api<{ intentId: string; bucket: string; path: string }>("/api/uploads/intents", {
    body: { purpose: "reference", mime, bytes: file.size, name: file.name.slice(0, 200) },
    signal,
  });
  try {
    if (file.size > CHUNK) {
      await tusUpload(intent.bucket, intent.path, file, mime, onProgress, signal);
    } else {
      const { error } = await browserClient().storage.from(intent.bucket).upload(intent.path, file, { contentType: mime, upsert: false });
      if (error) throw new Error("upload");
      onProgress(1);
    }
  } catch (e) {
    if (e instanceof UploadAborted || signal.aborted) throw new UploadAborted();
    throw new ApiClientError("UPLOAD_FAILED", "The upload did not finish. Check your connection and try again.", 0);
  }
  const done = await api<{ assetId: string }>(`/api/uploads/${intent.intentId}/finalize`, { method: "POST", body: {}, signal });
  return { assetId: done.assetId, name: file.name, mime, kind: kindOf(mime), bytes: file.size };
}
