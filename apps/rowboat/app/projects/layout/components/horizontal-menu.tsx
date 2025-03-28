'use client';
import { usePathname } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { 
  WrenchIcon, 
  PlayCircleIcon, 
  DatabaseIcon,
  PlugIcon,
  LayoutGridIcon
} from "lucide-react";
import { tokens } from "@/app/styles/design-tokens";
import { ThemeToggle } from '@/app/lib/components/theme-toggle';
import { UserButton } from "@/app/lib/components/user_button";
import { USE_AUTH } from "@/app/lib/feature_flags";

export default function HorizontalMenu() {
  const pathname = usePathname();
  const projectId = pathname.split('/')[2]; // Get projectId from URL if it exists
  const isProjectsRoute = pathname === '/projects' || pathname === '/projects/select';

  const navItems = [
    {
      href: '/projects',
      label: 'Projects',
      icon: LayoutGridIcon,
      alwaysEnabled: true
    },
    {
      href: `workflow`,
      label: 'Build',
      icon: WrenchIcon,
      requiresProject: true
    },
    {
      href: `test`,
      label: 'Test',
      icon: PlayCircleIcon,
      requiresProject: true
    },
    {
      href: `sources`,
      label: 'Connect',
      icon: DatabaseIcon,
      requiresProject: true
    },
    {
      href: `config`,
      label: 'Integrate',
      icon: PlugIcon,
      requiresProject: true
    }
  ];

  return (
    <div className={`flex items-center justify-between h-14 ${tokens.navigation.layout.padding.container}`}>
      <nav className={`flex items-center ${tokens.navigation.layout.gap}`}>
        {navItems.map((item) => {
          const Icon = item.icon;
          const fullPath = item.requiresProject ? `/projects/${projectId}/${item.href}` : item.href;
          const isActive = item.requiresProject 
            ? pathname.startsWith(fullPath)
            : pathname === item.href || (item.href === '/projects' && isProjectsRoute);
          const isDisabled = isProjectsRoute && item.requiresProject;
          
          return (
            <Link 
              key={item.href} 
              href={isDisabled ? '#' : fullPath}
              className={isDisabled ? 'pointer-events-none' : ''}
            >
              <button
                className={`
                  relative rounded-md flex items-center gap-2
                  ${tokens.navigation.layout.padding.item}
                  ${tokens.navigation.typography.size}
                  ${tokens.navigation.colors.background.hover}
                  ${isActive 
                    ? `${tokens.navigation.typography.weight.active} ${tokens.navigation.colors.item.active}`
                    : `${tokens.navigation.typography.weight.base} 
                       ${isDisabled 
                         ? 'text-zinc-300 dark:text-zinc-600' 
                         : `${tokens.navigation.colors.item.base} ${tokens.navigation.colors.item.hover}`
                       }`
                  }
                  transition-all duration-200 ease-out
                  active:translate-y-[1px]
                `}
              >
                <Icon 
                  size={16} 
                  className={`
                    transition-colors duration-200
                    ${isActive 
                      ? tokens.navigation.colors.item.icon.active
                      : `${isDisabled 
                          ? 'text-zinc-300 dark:text-zinc-600' 
                          : `${tokens.navigation.colors.item.icon.base} ${tokens.navigation.colors.item.icon.hover}`
                        }`
                    }
                  `}
                />
                <span>{item.label}</span>
                {isActive && (
                  <motion.div
                    layoutId="activeTab"
                    className={`
                      absolute -bottom-px left-0 right-0 h-[2px] z-10
                      ${tokens.navigation.colors.item.indicator}
                    `}
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ 
                      type: "spring",
                      stiffness: 380,
                      damping: 30,
                      duration: 0.2
                    }}
                  />
                )}
              </button>
            </Link>
          );
        })}
      </nav>

      {/* Theme Toggle and User Button */}
      <div className="flex items-center gap-2">
        <ThemeToggle />
        {USE_AUTH && <UserButton />}
      </div>
    </div>
  );
} 