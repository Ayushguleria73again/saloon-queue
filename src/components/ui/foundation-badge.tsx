"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Sparkles } from "lucide-react";

export function FoundationBadge() {
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.div
      initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="inline-flex items-center gap-2 rounded-full border border-subtle bg-surface px-3.5 py-1.5 text-xs font-medium text-ink-secondary shadow-sm"
    >
      <Sparkles className="h-3.5 w-3.5 text-brand-accent" aria-hidden="true" />
      <span>SalonFlow SaaS Foundation Ready</span>
    </motion.div>
  );
}
