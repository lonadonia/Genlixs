"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resetDemo } from "@/lib/demo-store";

export function ResetPreviewButton() {
  const [done, setDone] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="secondary"
        icon={<RotateCcw aria-hidden className="size-4" />}
        onClick={() => {
          resetDemo();
          setDone(true);
        }}
      >
        Reset preview data
      </Button>
      <span role="status" className="text-sm text-muted">
        {done ? "Preview data reset in this browser." : ""}
      </span>
    </div>
  );
}
