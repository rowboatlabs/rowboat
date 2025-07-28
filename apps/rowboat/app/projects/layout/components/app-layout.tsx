'use client';
import { ReactNode, useEffect, useState } from 'react';
import Sidebar from './sidebar';
import { usePathname } from 'next/navigation';
import { getCustomer } from '../../../actions/billing_actions';
import { Button } from '@heroui/react';
import { useRouter } from 'next/navigation';

interface AppLayoutProps {
  children: ReactNode;
  useAuth?: boolean;
  useBilling?: boolean;
}

export default function AppLayout({ children, useAuth = false, useBilling = false }: AppLayoutProps) {
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [billingPastDue, setBillingPastDue] = useState(false);
  const pathname = usePathname();

  let projectId: string | null = null;
  if (pathname.startsWith('/projects')) {
    projectId = pathname.split('/')[2];
  }

  useEffect(() => {
    async function checkBillingPastDue() {
      const billingCustomer = await getCustomer();
      if (billingCustomer.subscriptionStatus === "past_due") {
        setBillingPastDue(true);
      }
    }

    if (!useBilling) {
      return;
    }

    checkBillingPastDue();
  }, [useBilling]);

  // Layout with sidebar for all routes
  return (
    <div className="h-screen flex gap-5 p-5 bg-zinc-50 dark:bg-zinc-900">
      {/* Sidebar with improved shadow and blur */}
      <div className="overflow-hidden rounded-xl bg-white/70 dark:bg-zinc-800/70 shadow-sm backdrop-blur-sm">
        <Sidebar 
          projectId={projectId ?? undefined} 
          useAuth={useAuth}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          useBilling={useBilling}
        />
      </div>
      
      {/* Main content area */}
      <main className="flex gap-2 flex-col flex-1 overflow-auto rounded-xl bg-white dark:bg-zinc-800 shadow-sm p-4">
        {billingPastDue && <div className="shrink-0">
          <div className="bg-red-50 text-red-500 px-2 py-1 text-sm rounded-md flex items-center gap-2">
            <span>Your subscription is past due. Please update your payment information to avoid losing access to your projects.</span>
            <Button
              variant="flat"
              color="danger"
              size="sm"
              onPress={() => {
                router.push('/billing');
              }}>
              Resolve
            </Button>
          </div>
        </div>}
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </main>
    </div>
  );
} 