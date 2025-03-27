export const tokens = {
    colors: {
      background: {
        light: 'bg-gray-50',
        dark: 'dark:bg-gray-950'
      },
      surface: {
        light: 'bg-white',
        dark: 'dark:bg-gray-900'
      },
      border: {
        light: 'border-gray-300',
        dark: 'dark:border-gray-700',
        hover: {
          light: 'hover:border-gray-500',
          dark: 'dark:hover:border-gray-500'
        }
      },
      text: {
        primary: {
          light: 'text-gray-900',
          dark: 'dark:text-gray-100'
        },
        secondary: {
          light: 'text-gray-500',
          dark: 'dark:text-gray-400'
        }
      }
    },
    fonts: {
      heading: 'font-sans text-lg font-medium',
      body: 'font-sans text-sm',
    },
    spacing: {
      page: 'max-w-[768px] mx-auto',
      section: 'space-y-8'
    },
    radius: {
      sm: 'rounded',
      md: 'rounded-md',
      lg: 'rounded-lg',
      full: 'rounded-full'
    },
    defaultRadius: 'rounded-md'
}