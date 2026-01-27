import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/axios";
import { selectSchool } from "@/api/auth.api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Loader2 } from "lucide-react";

export default function SelectSchoolPage() {
  const navigate = useNavigate();
  const [schools, setSchools] = useState([]);
  const [schoolId, setSchoolId] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingSchools, setLoadingSchools] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        setLoadingSchools(true);
        const { data } = await api.get("/api/schools");
        setSchools(data?.schools || []);
      } catch (err) {
        setError("Failed to load schools");
      } finally {
        setLoadingSchools(false);
      }
    }

    load();
  }, []);

async function handleContinue() {
  if (!schoolId) return;
  setLoading(true);
  setError("");

  try {
    const data = await selectSchool(schoolId);

    // ✅ IMPORTANT: persist the new scoped token
    if (data?.token) localStorage.setItem("token", data.token);

    // ✅ Persist school context for SYSTEM_ADMIN header scoping
    localStorage.setItem("schoolId", schoolId);

    // optional: store selected school metadata for UI
    if (selectedSchool) {
      localStorage.setItem("selectedSchool", JSON.stringify(selectedSchool));
    }

    // optional: also refresh cached user role (if your axios relies on it)
    if (data?.user) {
      localStorage.setItem("user", JSON.stringify({ ...(JSON.parse(localStorage.getItem("user") || "{}")), ...data.user }));
    }

    navigate("/app/dashboard", { replace: true });
  } catch (err) {
    setError("Could not switch school context");
  } finally {
    setLoading(false);
  }
}


  const selectedSchool = schools.find(s => s.id === schoolId);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-muted/20 to-background p-4">
      <Card className="w-full max-w-lg shadow-lg">
        <CardHeader className="text-center pb-4">
          <div className="flex justify-center mb-2">
            <Badge variant="outline" className="font-normal">
              SYSTEM_ADMIN
            </Badge>
          </div>
          <CardTitle className="text-xl">Select School</CardTitle>
          <CardDescription className="text-base">
            Choose a school to manage from the list below
          </CardDescription>
        </CardHeader>

        <Separator />

        <CardContent className="pt-6 space-y-6">
          {error && (
            <div className="px-3 py-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md">
              {error}
            </div>
          )}

          <div className="space-y-3">
            <label className="text-sm font-medium">Available Schools</label>
            {loadingSchools ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : schools.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                No schools available
              </div>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
                {schools.map((school) => (
                  <div
                    key={school.id}
                    className={`p-3 rounded-lg border cursor-pointer transition-all ${
                      schoolId === school.id
                        ? "border-primary bg-primary/5"
                        : "border-muted hover:bg-muted/30 hover:border-muted-foreground/30"
                    }`}
                    onClick={() => setSchoolId(school.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-medium">{school.name}</div>
                      {!school.isActive && (
                        <Badge variant="outline" className="text-xs">
                          Suspended
                        </Badge>
                      )}
                    </div>
                    {school.id === schoolId && (
                      <div className="text-xs text-muted-foreground mt-1">
                        Click Continue to open this school
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {selectedSchool && (
            <div className="p-3 bg-muted/20 rounded-lg space-y-2">
              <div className="text-sm font-medium">Selected School</div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{selectedSchool.name}</div>
                  <div className="text-xs text-muted-foreground">
                    ID: {selectedSchool.id}
                  </div>
                </div>
                {!selectedSchool.isActive && (
                  <Badge variant="destructive" className="text-xs">
                    Suspended
                  </Badge>
                )}
              </div>
            </div>
          )}

          <Button
            className="w-full"
            disabled={!schoolId || loading || loadingSchools}
            onClick={handleContinue}
            size="lg"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Switching Context...
              </>
            ) : (
              "Continue to Dashboard"
            )}
          </Button>

          <div className="text-xs text-muted-foreground text-center pt-2">
            You'll be able to switch schools anytime from the system menu
          </div>
        </CardContent>
      </Card>
    </div>
  );
}