"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiClientError } from "./api";
import { TERMINAL_STATES, type Job } from "./types";
import { stageOf } from "./progress";

export type JobConnection = "loading" | "live" | "reconnecting" | "gone";

/**
 * Follows one stored job until it settles. Everything comes from the server, so a reload, another tab or a later
 * visit shows the same state; the generation itself never depends on this page staying open. Polls quickly while a
 * file is being saved, more slowly as a job ages, pauses in background tabs and retries with backoff when offline.
 */
export function useJob(jobId: string | null, onSettled?: (job: Job) => void) {
  const [job, setJob] = useState<Job | null>(null);
  const [connection, setConnection] = useState<JobConnection>("loading");
  const settledRef = useRef(onSettled);
  const kickRef = useRef<() => void>(() => {});
  useEffect(() => {
    settledRef.current = onSettled;
  });

  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    let timer: number | undefined;
    let inflight = false;
    let failures = 0;
    let settled = false;
    const started = Date.now();
    const schedule = (ms: number) => {
      window.clearTimeout(timer);
      if (!stop) timer = window.setTimeout(tick, document.visibilityState === "visible" ? ms : Math.max(ms, 30_000));
    };
    async function tick() {
      if (stop || inflight) return;
      inflight = true;
      try {
        const j = await api<Job>(`/api/generations/${jobId}`);
        if (stop) return;
        failures = 0;
        setJob(j);
        setConnection("live");
        if (TERMINAL_STATES.includes(j.state)) {
          if (!settled) {
            settled = true;
            settledRef.current?.(j);
          }
          return;
        }
        const age = Date.now() - started;
        schedule(stageOf(j) === "saving" ? 3000 : age < 120_000 ? 4000 : age < 600_000 ? 8000 : 15_000);
      } catch (e) {
        if (stop) return;
        if (e instanceof ApiClientError && e.status === 404) {
          setConnection("gone");
          return;
        }
        failures++;
        setConnection("reconnecting");
        schedule(Math.min(30_000, 2000 * 2 ** Math.min(failures, 4)));
      } finally {
        inflight = false;
      }
    }
    kickRef.current = () => {
      if (!settled) {
        window.clearTimeout(timer);
        void tick();
      }
    };
    const wake = () => {
      if (document.visibilityState === "visible") kickRef.current();
    };
    void tick();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      stop = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [jobId]);

  const reload = useCallback(() => kickRef.current(), []);
  return { job: job && jobId && job.id === jobId ? job : null, connection, reload };
}
