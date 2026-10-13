"use client";

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDemo } from "@/lib/demo-store";

export function Support() {
  const demo = useDemo();
  const ids = useId();
  const [topic, setTopic] = useState("");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<{ topic?: string; message?: string }>({});
  const [sent, setSent] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!topic) next.topic = "Choose what this is about.";
    if (message.trim().length < 10) next.message = "Describe the issue in at least 10 characters.";
    setErrors(next);
    if (Object.keys(next).length) {
      document.getElementById(next.topic ? `${ids}-topic` : `${ids}-msg`)?.focus();
      return;
    }
    setSent(true);
  };

  const field = "mt-1.5 block w-full rounded-[var(--radius-control)] border border-line-strong bg-raised px-3.5 text-[15px] text-ink aria-invalid:border-error-on-dark";

  return (
    <div className="mx-auto grid max-w-[1100px] gap-6 p-4 sm:p-6 lg:grid-cols-5 lg:p-8">
      <div className="lg:col-span-3">
        <h1 className="text-[1.75rem] font-semibold tracking-tight">Support</h1>
        <p className="text-muted">Tell us what happened. Linking a job helps us find it quickly.</p>

        {sent ? (
          <div role="status" className="mt-6 rounded-[var(--radius-media)] border border-line bg-surface p-5">
            <p className="font-semibold text-ink">Message not sent — preview mode</p>
            <p className="mt-1 text-sm text-muted">In production this creates a support case and confirms by email. Nothing left your browser.</p>
            <Button variant="secondary" className="mt-4" onClick={() => setSent(false)}>
              Write another message
            </Button>
          </div>
        ) : (
          <form noValidate onSubmit={submit} className="mt-6 space-y-5 rounded-[var(--radius-media)] border border-line bg-surface p-5">
            <div>
              <label htmlFor={`${ids}-topic`} className="text-sm font-semibold">
                Topic
              </label>
              <select
                id={`${ids}-topic`}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                aria-invalid={Boolean(errors.topic)}
                aria-describedby={errors.topic ? `${ids}-topic-e` : undefined}
                className={`${field} h-12`}
              >
                <option value="">Choose a topic</option>
                <option>A job failed or is delayed</option>
                <option>Credits or payment</option>
                <option>Download or file problem</option>
                <option>Account and sign-in</option>
                <option>Something else</option>
              </select>
              {errors.topic ? (
                <p id={`${ids}-topic-e`} className="mt-1.5 text-sm text-error-on-dark">
                  {errors.topic}
                </p>
              ) : null}
            </div>
            <div>
              <label htmlFor={`${ids}-job`} className="text-sm font-semibold">
                Related job <span className="font-normal text-muted">(optional)</span>
              </label>
              <select id={`${ids}-job`} className={`${field} h-12`} defaultValue="">
                <option value="">No specific job</option>
                {demo.jobs.slice(0, 8).map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.id} · {j.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${ids}-msg`} className="text-sm font-semibold">
                Message
              </label>
              <textarea
                id={`${ids}-msg`}
                rows={6}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                aria-invalid={Boolean(errors.message)}
                aria-describedby={errors.message ? `${ids}-msg-e` : undefined}
                className={`${field} py-3`}
              />
              {errors.message ? (
                <p id={`${ids}-msg-e`} className="mt-1.5 text-sm text-error-on-dark">
                  {errors.message}
                </p>
              ) : null}
            </div>
            <Button type="submit">Send message</Button>
          </form>
        )}
      </div>
      <aside className="space-y-3 lg:col-span-2 lg:pt-[4.5rem]">
        <div className="flex items-start gap-2 rounded-[var(--radius-media)] border border-line bg-surface p-4 text-sm text-muted">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-link" />
          <p>Never share passwords or payment card numbers in a message. Support can see the job records you link, not your private files unless you allow it.</p>
        </div>
        <nav aria-label="Help topics" className="rounded-[var(--radius-media)] border border-line bg-surface p-4">
          <p className="text-sm font-semibold">Quick answers</p>
          <ul className="mt-2 space-y-1 text-sm">
            <li>
              <Link href="/help#credits" className="text-link hover:underline">
                How credits work
              </Link>
            </li>
            <li>
              <Link href="/help#jobs" className="text-link hover:underline">
                Delayed and failed jobs
              </Link>
            </li>
            <li>
              <Link href="/status" className="text-link hover:underline">
                Service status
              </Link>
            </li>
          </ul>
        </nav>
      </aside>
    </div>
  );
}
