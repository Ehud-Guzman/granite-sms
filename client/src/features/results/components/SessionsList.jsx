import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function SessionsList({ sessions, activeSessionId, onOpen, classLabelById }) {
  return (
    <div className="grid gap-3">
      {sessions.map((s) => {
        const isActive = s.id === activeSessionId;
        const cls = classLabelById.get(s.classId) || s.classId;

        return (
          <Card key={s.id} className={isActive ? "border-primary" : ""}>
            <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="font-medium">{s.name}</div>
                <div className="text-sm opacity-70 flex flex-wrap gap-2 items-center">
                  <Badge variant="secondary">{s.status}</Badge>
                  <span>{cls}</span>
                  <span>
                    {s.term} {s.year}
                  </span>
                  {s.examType?.name && (
                    <span>
                      {s.examType.name} {s.examType.code ? `(${s.examType.code})` : ""}
                    </span>
                  )}
                </div>
              </div>

              <Button variant={isActive ? "outline" : "secondary"} onClick={() => onOpen(s.id)}>
                {isActive ? "Selected" : "Open"}
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
