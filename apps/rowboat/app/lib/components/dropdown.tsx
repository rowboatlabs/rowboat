import { Select, SelectItem } from "@nextui-org/react";
import { ReactNode } from "react";

export interface DropdownOption {
    key: string;
    label: string;
}

interface DropdownProps {
    options: DropdownOption[];
    value: string;
    onChange: (value: string) => void;
    className?: string;
}

export function Dropdown({
    options,
    value,
    onChange,
    className = "w-60"
}: DropdownProps) {
    return (
        <Select
            variant="bordered"
            selectedKeys={[value]}
            size="sm"
            className={className}
            onSelectionChange={(keys) => onChange(keys.currentKey as string)}
        >
            {options.map((option) => (
                <SelectItem key={option.key} value={option.key}>
                    {option.label}
                </SelectItem>
            ))}
        </Select>
    );
}
