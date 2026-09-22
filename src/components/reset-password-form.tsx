"use client";

import { useState } from "react";
import Link from "next/link";

export default function ResetPasswordForm({
  token,
}: {
  token: string;
}) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const inputClass =
    "mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:opacity-60";

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (isSubmitting) return;

    setError("");

    if (
      newPassword.length < 12 ||
      !/[A-Za-z]/.test(newPassword) ||
      !/[0-9]/.test(newPassword) ||
      !/[^A-Za-z0-9\s]/.test(newPassword)
    ) {
      setError(
        "Use at least 12 characters, including a letter, a number and a special character.",
      );
      return;
    }

    if (new TextEncoder().encode(newPassword).length > 72) {
      setError("The password is too long. Use no more than 72 UTF-8 bytes.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("The new passwords do not match.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/password/reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token,
          newPassword,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result.message || "Unable to reset your password.");
        return;
      }

      setNewPassword("");
      setConfirmPassword("");
      setSuccess(true);

      // Remove the secret token from the current address-bar entry.
      window.history.replaceState(null, "", "/reset-password");
    } catch {
      setError(
        "Unable to confirm the reset. Try signing in with your new password before requesting another link.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!/^[a-f0-9]{64}$/.test(token)) {
    return (
      <div className="space-y-4">
        <p role="alert" className="text-sm text-red-700">
          This reset link is invalid. Request a new link.
        </p>

        <Link
          href="/forgot-password"
          className="text-sm font-medium text-slate-700 hover:underline"
        >
          Request another reset link
        </Link>
      </div>
    );
  }

  if (success) {
    return (
      <div className="space-y-4">
        <p
          role="status"
          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700"
        >
          Your password has been reset. Please sign in again.
        </p>

        <Link
          href="/login"
          className="block rounded-lg bg-slate-900 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-slate-800"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <fieldset disabled={isSubmitting} className="space-y-4">
        <div>
          <label
            htmlFor="reset-new-password"
            className="block text-sm font-medium text-slate-700"
          >
            New password
          </label>

          <input
            id="reset-new-password"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            aria-describedby="reset-password-help"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            className={inputClass}
          />

          <p
            id="reset-password-help"
            className="mt-2 text-xs leading-5 text-slate-500"
          >
            Use at least 12 characters, including a letter, a number
            and a special character.
          </p>
        </div>

        <div>
          <label
            htmlFor="reset-confirm-password"
            className="block text-sm font-medium text-slate-700"
          >
            Confirm new password
          </label>

          <input
            id="reset-confirm-password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className={inputClass}
          />
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Resetting password..." : "Reset password"}
        </button>
      </fieldset>

      <div className="text-center">
        <Link
          href="/login"
          className="text-sm font-medium text-slate-600 hover:underline"
        >
          Back to sign in
        </Link>
      </div>
    </form>
  );
}