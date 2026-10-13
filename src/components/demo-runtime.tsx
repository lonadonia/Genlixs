"use client";

import { useEffect } from "react";
import { settleDemo } from "@/lib/demo-store";

/**
 * Settles simulated jobs/payments once they reach a terminal state, on any
 * page — so a job keeps running "in the library" after the visitor leaves
 * the studio (guide §08). Preview-only; production settlement is server-side.
 */
export function DemoRuntime() {
  useEffect(() => {
    settleDemo();
    const t = setInterval(settleDemo, 1000);
    return () => clearInterval(t);
  }, []);
  return null;
}
