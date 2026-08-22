"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { getCsrfTokenFromBrowser } from "@/lib/csrf";

type LoginResponse = {
  message?: string;
  redirectTo?: string;
  requiresOtp?: boolean;
  otpVerified?: boolean;
};

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [otpStep, setOtpStep] = useState<"credentials" | "verify" | "complete">("credentials");
  const [rememberDevice, setRememberDevice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(otpStep === "credentials" ? "/api/auth/login" : "/api/auth/verify-otp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": getCsrfTokenFromBrowser(),
        },
        body: JSON.stringify(otpStep === "credentials" ? { email, password } : { code: otp }),
      });

      const result = (await response.json()) as LoginResponse & { message?: string };

      if (!response.ok) {
        setError(result.message || "Login failed.");
        setIsSubmitting(false);
        return;
      }

      if (otpStep === "credentials" && result.requiresOtp) {
        setOtpStep("verify");
        setIsSubmitting(false);
        return;
      }

      if (otpStep === "verify" && result.otpVerified) {
        setOtpStep("complete");
        setIsSubmitting(false);
        return;
      }

      if (result.redirectTo) {
        router.replace(result.redirectTo);
      }
    } catch {
      setError("Unexpected error during login.");
      setIsSubmitting(false);
    }
  }

  async function completeOtpLogin() {
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/complete-otp-login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": getCsrfTokenFromBrowser(),
        },
        body: JSON.stringify({ rememberDevice }),
      });
      const result = (await response.json()) as LoginResponse;
      if (!response.ok) {
        setError(result.message || "Unable to complete login.");
        return;
      }
      router.replace(result.redirectTo || "/admin");
    } catch {
      setError("Unexpected error completing login.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (otpStep === "complete") {
    return (
      <div className="space-y-5">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Verification successful.
        </div>
        <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={rememberDevice}
            onChange={(e) => setRememberDevice(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300"
          />
          <span>
            <span className="block font-semibold text-slate-900">Remember this device</span>
            <span className="mt-1 block text-xs text-slate-500">You will not need an OTP on this device for 30 days.</span>
          </span>
        </label>
        {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}
        <button
          type="button"
          onClick={completeOtpLogin}
          disabled={isSubmitting}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3.5 text-base font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Continue to dashboard"}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {otpStep === "verify" ? (
        <>
          <div className="rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-900">
            <div className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4" />Verification code sent</div>
            <p className="mt-1 text-xs">Enter the 6-digit code sent to your email. It expires in 5 minutes.</p>
          </div>
          <div>
            <label htmlFor="otp" className="mb-2 block text-sm font-medium text-slate-700">One-time password</label>
            <input
              id="otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              className="w-full rounded-xl border border-slate-300 px-3 py-3 text-center text-xl tracking-[0.5em] text-slate-900 outline-none focus:ring-2 focus:ring-cyan-300"
              required
            />
          </div>
        </>
      ) : null}

      {otpStep === "credentials" ? (
        <>
          <div>
            <label htmlFor="email" className="mb-2 block text-sm font-medium text-slate-700">
              Email
            </label>
            <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2.5">
              <Mail className="h-4 w-4 text-slate-500" />
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full bg-transparent text-sm text-slate-900 outline-none"
                required
              />
            </div>
          </div>
          <div>
            <label htmlFor="password" className="mb-2 block text-sm font-medium text-slate-700">
              Password
            </label>
            <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2.5">
              <LockKeyhole className="h-4 w-4 text-slate-500" />
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                className="w-full bg-transparent text-sm text-slate-900 outline-none"
                required
              />
            </div>
          </div>
        </>
      ) : null}

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3.5 text-base font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Signing in...
          </>
        ) : (
          otpStep === "verify" ? "Verify code" : "Sign In"
        )}
      </button>

    </form>
  );
}
