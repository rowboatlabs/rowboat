'use client';
import { ThemeToggle } from '@/app/lib/components/theme-toggle';
import { UserButton } from "@/app/lib/components/user_button";
import { USE_AUTH } from "@/app/lib/feature_flags";
import { tokens } from "@/app/styles/design-tokens";
import { motion } from "framer-motion";

export default function TopBar() {
  return (
    <motion.div 
      className={`
        flex items-center justify-end h-14 px-6
        bg-white/70 dark:bg-zinc-800/70 backdrop-blur-sm
        transition-all duration-200
      `}
      initial={{ y: -10, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      {/* Theme Toggle and User Button with improved spacing */}
      <div className="flex items-center gap-4">
        <ThemeToggle />
        {USE_AUTH && (
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1 }}
          >
            <UserButton />
          </motion.div>
        )}
      </div>
    </motion.div>
  );
} 