// prompt-rewriter/components/output/card-skeleton.tsx
"use client";

/** 通用 shimmer 占位条 */
export function SkeletonBars({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-4 animate-pulse rounded-sm bg-warm-sand/60"
          style={{ width: `${85 - i * 8}%` }}
        />
      ))}
    </div>
  );
}

/** 等待中 hint(放骨架上方) */
export function WaitingHint({ label }: { label: string }) {
  return (
    <p className="mb-3 font-mono text-[12px] text-stone-gray">
      <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-coral" />
      {label}
    </p>
  );
}
