import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { api } from "@/api/axios";
import { clearToken } from "@/api/auth.api";

import { useMe } from "@/hooks/useMe";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

function validateNewPassword(pw) {
  const p = String(pw || "");
  return p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
}

export default function ChangePasswordPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useMe();

  const user = data?.user || null;

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");

  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  const canSubmit = useMemo(() => {
    if (loading) return false;
    if (!currentPassword.trim()) return false;
    if (!newPassword.trim()) return false;
    if (!confirmNewPassword.trim()) return false;
    if (newPassword !== confirmNewPassword) return false;
    return true;
  }, [currentPassword, newPassword, confirmNewPassword, loading]);

  const onSubmit = async (e) => {
    e.preventDefault();

    const cp = currentPassword.trim();
    const np = newPassword.trim();
    const cnp = confirmNewPassword.trim();

    if (!cp || !np || !cnp) {
      toast.error("All fields are required");
      return;
    }
    if (np !== cnp) {
      toast.error("New passwords do not match");
      return;
    }
    if (!validateNewPassword(np)) {
      toast.error("Password must be 8+ chars and include letters + numbers");
      return;
    }
    if (cp === np) {
      toast.error("New password must be different from current password");
      return;
    }

    setLoading(true);
    try {
      await api.post("/api/auth/change-password", {
        currentPassword: cp,
        newPassword: np,
      });

      toast.success("Password updated. Please sign in again.");

      // Force a clean re-login (simple + safe)
      clearToken();
      navigate("/auth/login", { replace: true });
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || "Failed to change password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted/30 grid place-items-center p-6">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center space-y-1">
          <div className="text-xl font-semibold">Change Password</div>
          <div className="text-sm text-muted-foreground">
            {isLoading ? "Loading account…" : "For security, you must update your password before continuing."}
          </div>
        </div>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              <span>Security update</span>
              {user?.role ? (
                <Badge variant="secondary" className="uppercase text-[10px]">
                  {user.role}
                </Badge>
              ) : null}
            </CardTitle>
          </CardHeader>

          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="text-xs text-muted-foreground">
                Account: <span className="text-foreground font-medium">{user?.email || "-"}</span>
              </div>

              <Separator />

              <div className="space-y-2">
                <label className="text-sm font-medium">Current password</label>
                <Input
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  type={showPw ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  disabled={loading}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">New password</label>
                <Input
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  type={showPw ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="At least 8 chars + letters + numbers"
                  disabled={loading}
                />
                <div className="text-xs text-muted-foreground">
                  Rule: 8+ chars, includes letters and numbers.
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Confirm new password</label>
                <Input
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  type={showPw ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="Repeat new password"
                  disabled={loading}
                />
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowPw((v) => !v)}
                  disabled={loading}
                >
                  {showPw ? "Hide" : "Show"}
                </Button>

                <Button type="submit" className="flex-1" disabled={!canSubmit}>
                  {loading ? "Updating…" : "Update password"}
                </Button>
              </div>

              <div className="text-xs text-muted-foreground leading-relaxed">
                After updating, you’ll sign in again. This prevents temporary passwords from being used long-term.
              </div>
            </form>
          </CardContent>
        </Card>

        <div className="text-center text-xs text-muted-foreground">
          Powered by <span className="font-medium text-foreground">GlimmerInk Creations</span>
        </div>
      </div>
    </div>
  );
}
