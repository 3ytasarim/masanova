import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";
import { controlBase } from "@/components/ui/field";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlBase, "h-11 px-3.5", className)} {...props} />;
}
