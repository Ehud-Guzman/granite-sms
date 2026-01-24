import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/axios";
import { selectSchool } from "@/api/auth.api";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function SelectSchoolPage() {
  const navigate = useNavigate();

  const [schools, setSchools] = useState([]);
  const [schoolId, setSchoolId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const { data } = await api.get("/api/schools");
        setSchools(data?.schools || []);
        
      } catch (err) {
        setError("Failed to load schools");
      }
    }

    load();
  }, []);

  async function handleContinue() {
    if (!schoolId) return;

    setLoading(true);
    setError("");

    try {
      await selectSchool(schoolId);

      // after switching context, go to dashboard
      navigate("/app/dashboard", { replace: true });
    } catch (err) {
      setError("Could not switch school context");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Select School</CardTitle>
          <div className="text-sm text-muted-foreground">
            You are logged in as SYSTEM_ADMIN.  
            Please choose a school to continue.
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {error && (
            <div className="text-sm text-red-600">{error}</div>
          )}

          <select
            className="w-full border rounded-md p-2 bg-background"
            value={schoolId}
            onChange={(e) => setSchoolId(e.target.value)}
          >
            <option value="">-- Choose a school --</option>

            {schools.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} {s.isActive ? "" : "(Suspended)"}
              </option>
            ))}
          </select>

          <Button
            className="w-full"
            disabled={!schoolId || loading}
            onClick={handleContinue}
          >
            {loading ? "Switching..." : "Continue"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
