// src/pages/Login.jsx
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { login, demoLogin } from "../api/auth.api";
import { IS_DEMO, DEMO_ROLES } from "@/lib/demo";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Building2, GraduationCap, ShieldCheck, UserRound, Wallet } from "lucide-react";

// One icon per demo role, so the five rows are scannable at a glance instead
// of reading as identical text. Decorative only — the real role check still
// happens server-side in POST /api/auth/demo-login.
const ROLE_ICONS = {
  ADMIN: ShieldCheck,
  TEACHER: GraduationCap,
  BURSAR: Wallet,
  STUDENT: UserRound,
  SYSTEM_ADMIN: Building2,
};

// Local development shortcuts only (matching prisma/seed.js). They are never
// shown on a deployed site, which is built in production mode.
const DEV_ACCOUNTS = [
  {
    key: "admin",
    label: "School Admin",
    email: "kutusprimary@gmail.com",
    password: "Kutus1234"
  },
  {
    key: "teacher",
    label: "Teacher",
    email: "guzman@gmail.com",
    password: "guzman123"
  },
];

function safeMsg(err) {
  return (
    err?.response?.data?.message ||
    err?.message ||
    "Login failed. Please try again."
  );
}

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || "/app/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

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

      if (!data?.token) throw new Error("Login response missing token");

      localStorage.setItem("token", data.token);
      localStorage.setItem("last_login_email", cleanEmail);

      if (data?.user) localStorage.setItem("user", JSON.stringify(data.user));

      const role = String(data?.user?.role || "").toUpperCase();
      if (role !== "SYSTEM_ADMIN") {
        localStorage.removeItem("schoolId");
        localStorage.removeItem("selectedSchool");
      }

      const mustChange =
        Boolean(data?.user?.mustChangePassword) ||
        Boolean(data?.mustChangePassword);

      toast.success("Welcome back");

      if (mustChange) {
        navigate("/auth/change-password", { replace: true });
        return;
      }

      navigate(from, { replace: true });
    } catch (err) {
      toast.error(safeMsg(err));
    } finally {
      setLoading(false);
    }
  };

  const fillDemoAccount = (acc) => {
    setEmail(acc.email);
    setPassword(acc.password);
  };

  // Demo build: one tap per role, no password.
  const [demoBusy, setDemoBusy] = useState("");
  const enterDemo = async (role) => {
    if (demoBusy) return;
    setDemoBusy(role);
    try {
      const data = await demoLogin(role);
      if (!data?.token) throw new Error("The demo did not answer. Please try again.");
      navigate(role === "SYSTEM_ADMIN" ? "/select-school" : "/app/dashboard", { replace: true });
    } catch (err) {
      // A free-tier API that has been asleep answers the first request slowly.
      toast.error(
        err?.response?.data?.message ||
          "The demo is waking up. Please try again in a few seconds."
      );
      setDemoBusy("");
    }
  };

  if (IS_DEMO) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-muted/20 to-background flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">Granite SMS</h1>
            <p className="text-muted-foreground">
              School management for Mwangaza Academy, a sample school
            </p>
          </div>

          <Card className="border-0 shadow-lg">
            <CardHeader className="text-center">
              <CardTitle className="text-xl">Explore the live demo</CardTitle>
              <CardDescription>
                Pick a role. No sign-up and no password. Everything is sample data, and nothing you do is saved.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {DEMO_ROLES.map((r) => {
                const Icon = ROLE_ICONS[r.role] || UserRound;
                return (
                  <button
                    key={r.role}
                    type="button"
                    onClick={() => enterDemo(r.role)}
                    disabled={!!demoBusy}
                    className="flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/40 hover:border-primary/40 disabled:opacity-60"
                  >
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Icon className="h-4.5 w-4.5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <div className="font-medium">
                        {demoBusy === r.role ? "Opening…" : `Explore as ${r.label}`}
                      </div>
                      <div className="text-xs text-muted-foreground">{r.note}</div>
                    </span>
                  </button>
                );
              })}
              {demoBusy && (
                <p className="pt-1 text-center text-xs text-muted-foreground" role="status">
                  If nobody has visited for a while, the demo can take up to a minute to wake up.
                </p>
              )}
            </CardContent>
          </Card>

          <div className="text-center text-xs text-muted-foreground">
            <p>© {new Date().getFullYear()} GlimmerInk Creations</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/20 to-background flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Granite SMS</h1>
          <p className="text-muted-foreground">
            School Management System
          </p>
        </div>

        {/* Login Card */}
        <Card className="border-0 shadow-lg">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Sign In</CardTitle>
            <CardDescription>
              Enter your credentials to access the system
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@school.ac.ke"
                  autoComplete="email"
                  disabled={loading}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0 text-xs"
                    onClick={() => setShowPw(!showPw)}
                  >
                    {showPw ? "Hide" : "Show"} password
                  </Button>
                </div>
                <Input
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  type={showPw ? "text" : "password"}
                  autoComplete="current-password"
                  disabled={loading}
                />
              </div>

              <Button 
                type="submit" 
                className="w-full" 
                disabled={!canSubmit}
                size="lg"
              >
                {loading ? "Signing in..." : "Sign In"}
              </Button>

              <div className="text-xs text-center text-muted-foreground pt-2">
                By signing in, you confirm you're authorized to access this system.
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Dev shortcuts (local development only) */}
        {import.meta.env.DEV && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Demo Access</CardTitle>
            <CardDescription className="text-xs">
              Use these accounts to explore the system
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {DEV_ACCOUNTS.map((acc) => (
              <div
                key={acc.key}
                className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/30 transition-colors"
              >
                <div className="space-y-0.5">
                  <div className="font-medium">{acc.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {acc.email}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => fillDemoAccount(acc)}
                    disabled={loading}
                  >
                    Use
                  </Button>
                </div>
              </div>
            ))}
            <div className="text-xs text-muted-foreground text-center pt-2">
              Passwords are pre-filled when you click "Use"
            </div>
          </CardContent>
        </Card>
        )}

        {/* Footer */}
        <div className="text-center text-xs text-muted-foreground">
          <p>© {new Date().getFullYear()} GlimmerInk Creations</p>
          <p className="mt-1">School Management System</p>
        </div>
      </div>
    </div>
  );
}