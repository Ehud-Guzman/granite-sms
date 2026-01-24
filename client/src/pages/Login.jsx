// src/pages/Login.jsx
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { login } from "../api/auth.api";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || "/app/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  // Remember last email (nice UX)
  useEffect(() => {
    const saved = localStorage.getItem("last_login_email");
    if (saved) setEmail(saved);
  }, []);

  const canSubmit = useMemo(() => {
    return email.trim().length > 0 && password.trim().length > 0 && !loading;
  }, [email, password, loading]);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;

    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = password.trim();

    if (!cleanEmail || !cleanPassword) {
      toast.error("Email and password are required");
      return;
    }

    setLoading(true);
    try {
      const data = await login({ email: cleanEmail, password: cleanPassword });

      if (!data?.token) {
        throw new Error("Login response missing token");
      }

      localStorage.setItem("token", data.token);
      localStorage.setItem("last_login_email", cleanEmail);

      // Optional: cache user for instant role-based UI while /me loads
      if (data?.user) localStorage.setItem("user", JSON.stringify(data.user));

      toast.success("Welcome back");
      navigate(from, { replace: true });
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        "Login failed. Please try again.";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-muted/40 via-background to-background" />
      <div className="absolute -top-24 -left-24 h-72 w-72 rounded-full bg-muted/40 blur-3xl" />
      <div className="absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-muted/40 blur-3xl" />

      <div className="relative min-h-screen grid place-items-center p-6">
        <div className="w-full max-w-md space-y-4">
          {/* Brand */}
          <div className="text-center space-y-1">
            <div className="inline-flex items-center gap-2">
              <div className="h-9 w-9 rounded-xl border bg-background flex items-center justify-center font-bold">
                G
              </div>
              <div className="text-left">
                <div className="text-xl font-semibold leading-none">
                  Granite SMS
                </div>
                <div className="text-sm text-muted-foreground">
                  Secure sign-in portal
                </div>
              </div>
            </div>
          </div>

          {/* Login Card */}
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Sign in</CardTitle>
              <div className="text-sm text-muted-foreground">
                Enter your email and password to continue.
              </div>
            </CardHeader>

            <CardContent>
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="email">
                    Email
                  </label>
                  <Input
                    id="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@school.ac.ke"
                    autoComplete="email"
                    inputMode="email"
                    disabled={loading}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="password">
                    Password
                  </label>
                  <div className="flex gap-2">
                    <Input
                      id="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      type={showPw ? "text" : "password"}
                      autoComplete="current-password"
                      disabled={loading}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShowPw((v) => !v)}
                      className="shrink-0"
                      disabled={loading}
                      title={showPw ? "Hide password" : "Show password"}
                      aria-label={showPw ? "Hide password" : "Show password"}
                    >
                      {showPw ? "Hide" : "Show"}
                    </Button>
                  </div>
                </div>

                <Button type="submit" className="w-full" disabled={!canSubmit}>
                  {loading ? "Signing in…" : "Sign in"}
                </Button>

                <div className="text-xs text-muted-foreground leading-relaxed">
                  By signing in, you confirm you’re authorized to access this
                  system. Unauthorized access is prohibited.
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Credits */}
          <div className="text-center text-xs text-muted-foreground">
            Powered by{" "}
            <span className="font-medium text-foreground">
              GlimmerInk Creations
            </span>
            <span className="mx-2 opacity-50">•</span>
            <span>© {new Date().getFullYear()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
