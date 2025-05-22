'use client';
import { useUser } from '@auth0/nextjs-auth0/client';
import { Avatar, Dropdown, DropdownItem, DropdownSection, DropdownTrigger, DropdownMenu } from "@heroui/react";
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export function UserButton({ useBilling }: { useBilling?: boolean }) {
    const router = useRouter();
    const { user } = useUser();
    if (!user) {
        return <></>;
    }

    const name = user.name ?? user.email ?? 'Unknown user';

    return <Dropdown>
        <DropdownTrigger>
            <Avatar
                name={name}
                size="sm"
                className="cursor-pointer"
            />
        </DropdownTrigger>
        <DropdownMenu
            onAction={(key) => {
                if (key === 'logout') {
                    router.push('/api/auth/logout');
                }
                if (key === 'billing') {
                    router.push('/billing');
                }
            }}
        >
            <DropdownSection title={name}>
                {useBilling ? (
                    <DropdownItem key="billing">
                        Billing
                    </DropdownItem>
                ) : (
                    <></>
                )}
                <DropdownItem key="logout">
                    Logout
                </DropdownItem>
            </DropdownSection>
        </DropdownMenu>
    </Dropdown>
}