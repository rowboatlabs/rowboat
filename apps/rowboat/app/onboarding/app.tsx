"use client";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { FormStatusButton } from "@/app/lib/components/form-status-button";
import { useRouter } from "next/navigation";
import { updateUserEmail } from "../actions/auth_actions";
import { tokens } from "@/app/styles/design-tokens";
import { SectionHeading } from "@/components/ui/section-heading";
import { HorizontalDivider } from "@/components/ui/horizontal-divider";
import clsx from 'clsx';

export default function App() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    if (!email.trim()) {
      setError("Please enter your email.");
      return;
    }
    setSubmitted(true);

    try {
      await updateUserEmail(email);
      router.push('/projects');
    } catch (error) {
      setError("Failed to update email.");
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-8 py-8 space-y-8">
      <div className="px-4">
        <h1 className={clsx(
          tokens.typography.sizes.xl,
          tokens.typography.weights.semibold,
          tokens.colors.light.text.primary,
          tokens.colors.dark.text.primary
        )}>
          Complete your profile
        </h1>
      </div>

      <section className="card">
        <div className="px-4 pt-4 pb-6">
          <SectionHeading>
            Complete your profile
          </SectionHeading>
        </div>
        <HorizontalDivider />
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div className="space-y-4">
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
            {error && (
              <div className={clsx(
                tokens.typography.sizes.sm,
                "text-red-500"
              )}>
                {error}
              </div>
            )}
          </div>
          <div className="flex justify-end">
            <FormStatusButton
              props={{
                type: "submit",
                children: submitted ? "Submitted!" : "Continue",
                variant: "primary",
                size: "md",
                isLoading: false,
                disabled: submitted,
              }}
            />
          </div>
        </form>
      </section>
    </div>
  );
}
