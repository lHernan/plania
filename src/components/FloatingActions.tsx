"use client";

import { motion } from "framer-motion";
import { Plus } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { ChatFab } from "@/components/ChatFab";

/**
 * Quick actions ("+" and travel agent) as one group with consistent spacing.
 * The group never positions itself: the caller decides where it lives — fixed over the
 * page, or inside the map's bottom dock so it stacks above the activity card.
 */
export function FloatingActions({
  onAdd,
  showAgent = true,
  className = "",
}: {
  onAdd?: () => void;
  showAgent?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  if (!onAdd && !showAgent) return null;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {onAdd && (
        <motion.button
          type="button"
          whileHover={{ scale: 1.1, rotate: 90 }}
          whileTap={{ scale: 0.9 }}
          onClick={onAdd}
          aria-label={t("add_activity")}
          title={t("add_activity")}
          className="md:hidden size-14 rounded-2xl bg-[var(--color-primary)] text-white shadow-2xl shadow-[var(--color-primary)]/20 flex items-center justify-center transition-all ring-4 ring-[var(--color-primary)]/10"
        >
          <Plus size={24} />
        </motion.button>
      )}
      {showAgent && <ChatFab />}
    </div>
  );
}
