"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { FormSection } from "@/app/lib/components/form-section";
import { FormStatusButton } from "@/app/lib/components/form-status-button";
import { useRouter } from "next/navigation";
import { createBillingProfile } from "@/app/actions/billing_actions";

export default function App() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    if (!name.trim() || !email.trim()) {
      setError("Please enter both name and email.");
      return;
    }
    setSubmitted(true);

    try {
      await createBillingProfile(name, email);
      router.push('/projects');
    } catch (error) {
      setError("Failed to create billing profile.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-md mx-auto mt-8 space-y-6">
      <FormSection label="Create Profile">
        <Input
          label="Name"
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Your name"
          required
        />
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
        />
        {error && <div className="text-red-500 text-sm mt-2">{error}</div>}
        <FormStatusButton
          props={{
            type: "submit",
            children: submitted ? "Submitted!" : "Submit",
            variant: "primary",
            size: "md",
            isLoading: false,
            disabled: submitted,
          }}
        />
      </FormSection>
    </form>
  );
}
