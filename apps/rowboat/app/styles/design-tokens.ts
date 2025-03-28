export const tokens = {
  typography: {
    fonts: {
      sans: 'Inter, system-ui, -apple-system, sans-serif',
    },
    weights: {
      normal: 'font-normal',
      medium: 'font-medium',
      semibold: 'font-semibold',
    },
    sizes: {
      xs: 'text-xs',
      sm: 'text-sm',
      base: 'text-base',
      lg: 'text-lg',
      xl: 'text-xl',
      '2xl': 'text-2xl',
    }
  },
  colors: {
    light: {
      background: 'bg-[#F9FAFB]',
      surface: 'bg-white',
      surfaceHover: 'hover:bg-gray-50',
      border: 'border-[#E5E7EB]',
      text: {
        primary: 'text-[#111827]',
        secondary: 'text-[#4B5563]',
        tertiary: 'text-[#6B7280]',
        muted: 'text-[#9CA3AF]',
      }
    },
    dark: {
      background: 'dark:bg-[#0E0E10]',
      surface: 'dark:bg-[#1A1A1D]',
      surfaceHover: 'dark:hover:bg-[#1F1F23]',
      border: 'dark:border-[#2E2E30]',
      text: {
        primary: 'dark:text-[#F3F4F6]',
        secondary: 'dark:text-[#E5E7EB]',
        tertiary: 'dark:text-[#D1D5DB]',
        muted: 'dark:text-[#9CA3AF]',
      }
    },
    accent: {
      primary: 'bg-indigo-600 hover:bg-indigo-500',
      primaryDark: 'dark:bg-indigo-500 dark:hover:bg-indigo-400',
    }
  },
  shadows: {
    sm: 'shadow-[0_2px_8px_rgba(0,0,0,0.05)]',
    md: 'shadow-[0_4px_12px_rgba(0,0,0,0.08)]',
    hover: 'hover:shadow-[0_8px_16px_rgba(0,0,0,0.1)]',
  },
  transitions: {
    default: 'transition-all duration-200 ease-in-out',
    transform: 'transition-transform duration-200 ease-in-out',
  },
  radius: {
    sm: 'rounded-md', // 6px
    md: 'rounded-lg', // 8px
    lg: 'rounded-xl', // 12px
    full: 'rounded-full',
  },
  focus: {
    default: 'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2',
    dark: 'dark:focus:ring-offset-[#0E0E10]',
  },
  spacing: {
    page: 'max-w-[768px] mx-auto',
    section: 'space-y-8'
  },
  navigation: {
    colors: {
      item: {
        base: 'text-zinc-600 dark:text-zinc-400',
        hover: 'hover:text-zinc-900 dark:hover:text-zinc-200',
        active: 'text-zinc-900 dark:text-zinc-100',
        icon: {
          base: 'text-zinc-400 dark:text-zinc-500',
          hover: 'group-hover:text-zinc-600 dark:group-hover:text-zinc-300',
          active: 'text-indigo-600 dark:text-indigo-400'
        },
        indicator: 'bg-indigo-600 dark:bg-indigo-400'
      },
      background: {
        hover: 'hover:bg-zinc-100 dark:hover:bg-zinc-800/50'
      }
    },
    typography: {
      size: 'text-[15px]',
      weight: {
        base: 'font-medium',
        active: 'font-semibold'
      }
    },
    layout: {
      padding: {
        container: 'px-6',
        item: 'px-3 py-1.5'
      },
      gap: 'gap-6'
    }
  }
}

export type Tokens = typeof tokens; 