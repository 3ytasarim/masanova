import type { TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";
import { controlBase } from "@/components/ui/field";

export function Textarea({ className, rows = 4, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={rows} className={cn(controlBase, "min-h-24 resize-y px-3.5 py-2.5 leading-relaxed", className)} {...props} />;
}
