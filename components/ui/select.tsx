"use client";

// shadcn-style Select wrapper over @base-ui/react/select。
// 视觉沿用项目暖色规范:ivory 底 / warm-sand 选中态 / terracotta 标记色,禁冷蓝灰。
//
// 用法跟 shadcn radix-select 一致:
//   <Select value={v} onValueChange={setV}>
//     <SelectTrigger><SelectValue placeholder="..." /></SelectTrigger>
//     <SelectContent>
//       <SelectGroup>
//         <SelectLabel>分组</SelectLabel>
//         <SelectItem value="a">选项 A</SelectItem>
//       </SelectGroup>
//     </SelectContent>
//   </Select>

import * as React from "react";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

function Select<Value = string>(
  props: SelectPrimitive.Root.Props<Value, false>
) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectValue({ ...props }: SelectPrimitive.Value.Props) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
  className,
  children,
  ...props
}: SelectPrimitive.Trigger.Props) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "inline-flex items-center justify-between gap-2 rounded-sm border border-border-cream bg-ivory px-2 py-1 font-sans text-[13px] text-near-black outline-none transition-colors hover:bg-warm-sand/40 focus:border-coral data-popup-open:border-coral",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon className="text-stone-gray">
        <ChevronDown size={14} />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  sideOffset = 4,
  ...props
}: SelectPrimitive.Popup.Props & {
  sideOffset?: number;
}) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            "z-50 max-h-[60vh] min-w-[var(--anchor-width)] origin-(--transform-origin) overflow-y-auto rounded-lg border border-border-cream bg-ivory p-1 text-[13px] text-near-black shadow-md outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        >
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectGroup({ ...props }: SelectPrimitive.Group.Props) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectLabel({ className, ...props }: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn(
        "px-2 pb-1 pt-2 font-mono text-[11px] uppercase tracking-wide text-stone-gray",
        className
      )}
      {...props}
    />
  );
}

function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex cursor-pointer select-none items-center gap-2 rounded-sm py-1.5 pl-7 pr-2 text-[13px] text-near-black outline-none transition-colors data-highlighted:bg-warm-sand/60 data-selected:bg-coral-soft-bg data-disabled:pointer-events-none data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemIndicator className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center text-terracotta">
        <Check size={12} />
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
};
