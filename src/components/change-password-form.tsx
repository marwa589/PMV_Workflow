"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getCsrfTokenFromBrowser } from "@/lib/csrf";

export default function ChangePasswordForm() {
  const router = useRouter();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (isSubmitting) return;

    setError("");

    if (newPassword.length < 12) {
      setError("Use at least 12 characters, including a letter, a number and a special character such as !, @ or #.");
      return;
    }
    if (!/[A-Za-z]/.test(newPassword)) {
  setError("Your new password must contain at least one letter.");
  return;
}

if (!/[0-9]/.test(newPassword)) {
  setError("Your new password must contain at least one number.");
  return;
}

if (!/[^A-Za-z0-9\s]/.test(newPassword)) {
  setError("Your new password must contain at least one special character.");
  return;
}

    if (newPassword !== confirmPassword) {
      setError("The new passwords do not match.");
      return;
    }

    if (newPassword === currentPassword) {
      setError("Choose a password different from your current password.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/password/change", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": getCsrfTokenFromBrowser(),
        },
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result.message || "Unable to change your password.");
        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");

      router.replace("/login");
      router.refresh();
    } catch {
      setError(
        "Unable to confirm the password change. Try signing in with your new password before retrying.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const inputClass =
  "mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:opacity-60";

  return (
    <section className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">
        Change password
      </h2>

      <p className="mt-2 text-sm text-slate-600">
        After changing your password, you will need to sign in again
        on all devices.
      </p>

      <form
        onSubmit={handleSubmit}
        className="mt-5  space-y-4"
      >
        <fieldset disabled={isSubmitting} className="space-y-4">
          <div>
            <label
              htmlFor="current-password"
              className="block text-sm font-medium text-slate-700"
            >
              Current password
            </label>
            <input
              id="current-password"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(event) =>
                setCurrentPassword(event.target.value)
              }
              className={inputClass}
            />
          </div>

          <div>
            <label
              htmlFor="new-password"
              className="block text-sm font-medium text-slate-700"
            >
              New password
            </label>
            <input
              id="new-password"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              aria-describedby="password-help"
              value={newPassword}
              onChange={(event) =>
                setNewPassword(event.target.value)
              }
              className={inputClass}
            />
            <p
              id="password-help"
              className="mt-1 text-xs text-slate-500"
            >
              Use at least 12 characters.
            </p>
          </div>

          <div>
            <label
              htmlFor="confirm-password"
              className="block text-sm font-medium text-slate-700"
            >
              Confirm new password
            </label>
            <input
              id="confirm-password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={confirmPassword}
              onChange={(event) =>
                setConfirmPassword(event.target.value)
              }
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
            {isSubmitting ? "Changing password..." : "Change password"}
          </button>
        </fieldset>
      </form>
    </section>
  );
}