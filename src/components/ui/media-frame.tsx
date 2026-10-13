import Image from "next/image";
import type { ReactNode } from "react";
import { MEDIA, type MediaKey } from "@/lib/media";
import { cn } from "@/lib/format";
import { ConceptTag } from "./badge";

const ratioClass: Record<string, string> = {
  "16:9": "aspect-video",
  "3:2": "aspect-[3/2]",
  "2:3": "aspect-[2/3]",
  "1:1": "aspect-square",
  "4:5": "aspect-[4/5]",
  "9:16": "aspect-[9/16]",
  "4:3": "aspect-[4/3]",
};

/** Fixed-ratio media frame: space is reserved before the file arrives (guide §08). */
export function MediaFrame({
  media,
  ratio = "3:2",
  sizes = "(min-width: 1024px) 50vw, 100vw",
  priority,
  concept = true,
  className,
  imgClassName,
  children,
  alt,
}: {
  media: MediaKey;
  ratio?: string;
  sizes?: string;
  priority?: boolean;
  concept?: boolean;
  className?: string;
  imgClassName?: string;
  children?: ReactNode;
  alt?: string;
}) {
  const m = MEDIA[media];
  const src = m.kind === "video" ? m.poster! : m.src;
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[var(--radius-media)] border border-line bg-raised",
        ratioClass[ratio] ?? "aspect-[3/2]",
        className,
      )}
    >
      <Image src={src} alt={alt ?? m.alt} fill sizes={sizes} priority={priority} className={cn("object-cover", imgClassName)} />
      {concept ? <ConceptTag className="absolute top-3 left-3" /> : null}
      {children}
    </div>
  );
}

export { ratioClass };
