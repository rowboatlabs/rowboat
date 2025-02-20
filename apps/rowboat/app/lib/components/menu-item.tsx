import React from 'react';
import clsx from 'clsx';

interface MenuItemProps {
  icon: React.ReactNode;
  children: React.ReactNode;
  selected: boolean;
  onClick: () => void;
}

const MenuItem: React.FC<MenuItemProps> = ({ icon, children, selected, onClick }) => {
  return (
    <button
      className={clsx(
        "w-full flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors",
        "hover:bg-gray-100 dark:hover:bg-gray-800",
        {
          "bg-gray-100 dark:bg-gray-800": selected,
          "text-gray-600 dark:text-gray-400": !selected,
          "text-gray-900 dark:text-gray-100": selected,
        }
      )}
      onClick={onClick}
    >
      {icon}
      {children}
    </button>
  );
};

export default MenuItem; 