"use client";

import { useCallback, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { api, ApiClientError, errorMessage } from "@/lib/live/api";
import { Notice, STATE_INFO } from "./shared";
import type { Access, AdminModel, AvailabilityState, Readiness, Runtime } from "./types";

type Target = Pick<AdminModel, "id" | "name" | "state" | "verificationStatus" | "verifiedCurrent"> & { readiness: Readiness };
type Plan =
  | { kind: "blocked"; model: Target; state: AvailabilityState; message: string; fix?: { label: string; run: () => void } }
  | { kind: "confirm"; model: Target; state: AvailabilityState; note: string | null; publishDraft: { id: string; version: string } | null; untested: boolean };

/**
 * One availability flow for the row switch, bulk actions and the model panel. Enabling checks the same conditions
 * the server enforces and explains a blocked change with a direct fix; the owner can publish a ready draft and/or
 * accept the single "untested" warning in the same step. Routine changes need no typed reason.
 */
export function useAvailability({ access, runtime, onChanged, onFix }: {
  access: Access;
  runtime: Runtime;
  onChanged: () => void;
  onFix: (modelId: string, section: "pricing" | "test" | "cost") => void;
}) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    async (model: Target, state: AvailabilityState, note: string | null, extra: { acceptUntested?: boolean; publishPriceVersionId?: string | null } = {}) => {
      setBusy(true);
      setError(null);
      try {
        await api(`/api/admin/catalog/models/${model.id}/availability`, { body: { state, note, ...extra } });
        setPlan(null);
        onChanged();
        return true;
      } catch (e) {
        setError(errorMessage(e));
        if (e instanceof ApiClientError && !plan) setPlan({ kind: "blocked", model, state, message: e.message });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onChanged, plan],
  );

  const request = useCallback(
    (model: Target, state: AvailabilityState, note: string | null = null) => {
      setError(null);
      setAccepted(false);
      if (!access.canOperate) {
        setPlan({ kind: "blocked", model, state, message: "Your role can view models but not change their availability." });
        return;
      }
      if (state === "disabled" || state === "maintenance") {
        void send(model, state, note);
        return;
      }
      if (!runtime.submitsEnabled) {
        setPlan({ kind: "blocked", model, state, message: "This deployment cannot send work to KIE (the server key is missing). Customers could not generate with this model." });
        return;
      }
      const failing = model.readiness.checks.filter((c) => !c.ok && !c.warning);
      const price = failing.find((c) => c.key === "price");
      const others = failing.filter((c) => c.key !== "price");
      if (others.length) {
        const c = others[0];
        setPlan({
          kind: "blocked",
          model,
          state,
          message: `${c.label}: ${c.detail}`,
          fix: c.fix === "edit_cost" ? { label: "Open KIE cost", run: () => onFix(model.id, "cost") } : undefined,
        });
        return;
      }
      let publishDraft: { id: string; version: string } | null = null;
      if (price) {
        if (price.fix === "publish_draft" && price.draftPriceVersionId && access.canPublish) {
          publishDraft = { id: price.draftPriceVersionId, version: price.detail.match(/v(\d+)/)?.[1] ?? "" };
        } else {
          setPlan({
            kind: "blocked",
            model,
            state,
            message:
              price.fix === "publish_draft"
                ? `${price.detail} Publishing prices needs the owner.`
                : price.detail,
            fix: { label: "Edit pricing", run: () => onFix(model.id, "pricing") },
          });
          return;
        }
      }
      const verified = model.readiness.checks.find((c) => c.key === "verification")?.ok ?? false;
      if (!verified && !access.canPublish) {
        setPlan({
          kind: "blocked",
          model,
          state,
          message: "This model has no successful private test. Run a test, or ask the owner to enable it using the documented KIE cost.",
          fix: access.canTest ? { label: "Run a test", run: () => onFix(model.id, "test") } : undefined,
        });
        return;
      }
      if (!verified || publishDraft) {
        setPlan({ kind: "confirm", model, state, note, publishDraft, untested: !verified });
        return;
      }
      void send(model, state, note);
    },
    [access, runtime.submitsEnabled, send, onFix],
  );

  let dialog: ReactNode = null;
  if (plan) {
    const title = plan.kind === "blocked" ? `${plan.model.name} can’t be ${STATE_INFO[plan.state].label.toLowerCase()} yet` : `${STATE_INFO[plan.state].label === "Enabled" ? "Enable" : "Make experimental"}: ${plan.model.name}`;
    dialog = (
      <Dialog
        open
        surface="light"
        title={title}
        onClose={() => setPlan(null)}
        footer={
          plan.kind === "blocked" ? (
            <>
              <Button variant="ghost-light" onClick={() => setPlan(null)}>
                Close
              </Button>
              {plan.fix ? (
                <Button
                  onClick={() => {
                    const f = plan.fix!;
                    setPlan(null);
                    f.run();
                  }}
                >
                  {plan.fix.label}
                </Button>
              ) : null}
            </>
          ) : (
            <>
              <Button variant="ghost-light" onClick={() => setPlan(null)}>
                Cancel
              </Button>
              <Button
                busy={busy}
                disabled={plan.untested && !accepted}
                onClick={() =>
                  void send(plan.model, plan.state, plan.note, {
                    acceptUntested: plan.untested ? true : undefined,
                    publishPriceVersionId: plan.publishDraft?.id ?? null,
                  })
                }
              >
                {plan.publishDraft ? "Publish price and enable" : plan.untested ? "Enable using documented cost" : "Enable"}
              </Button>
            </>
          )
        }
      >
        {plan.kind === "blocked" ? (
          <p className="text-sm">{plan.message}</p>
        ) : (
          <div className="space-y-4 text-sm">
            <p>{STATE_INFO[plan.state].customer}</p>
            {plan.publishDraft ? (
              <Notice title={`Price draft v${plan.publishDraft.version} will be published first`}>
                It becomes a new immutable price version. New quotes use it; running jobs keep the price they were quoted.
              </Notice>
            ) : null}
            {plan.untested ? (
              <div className="rounded-xl border border-[#f3d9a8] bg-orange-tint p-4 text-orange-text">
                <p className="font-semibold">This model has not passed a private test.</p>
                <p className="mt-1">
                  Customers will be charged the published price, based on KIE’s documented cost. The model stays marked “Untested” until a
                  private test delivers a validated file.
                </p>
                <label className="mt-3 flex items-start gap-2 font-semibold">
                  <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5 size-4 accent-brand-blue" />
                  I understand and want to enable it using the documented cost.
                </label>
              </div>
            ) : null}
            {error ? <Notice tone="error">{error}</Notice> : null}
          </div>
        )}
      </Dialog>
    );
  }
  return { request, dialog, busy, error, clearError: () => setError(null) };
}
