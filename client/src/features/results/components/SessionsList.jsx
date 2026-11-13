import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fmtClass } from "../utils/format";

// The exam list. When `detail` is given, the opened exam's content shows right
// under its own card (an accordion), so it is obvious what opened.
export default function SessionsList({ sessions, activeSessionId, onOpen, onClose, classLabelById, termLabels, detail }) {
  return (
    <div className="grid gap-3">
      {sessions.map((s) => {
        const isActive = s.id === activeSessionId;
        const cls = classLabelById.get(s.classId) || (s.class ? fmtClass(s.class) : "");

        return (
          <div key={s.id} className={isActive && detail ? "rounded-xl ring-2 ring-primary/60" : ""}>
            <Card className={isActive ? "border-primary bg-primary/5" : ""}>
              <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="font-medium">{s.name}</div>
                  <div className="text-sm opacity-70 flex flex-wrap gap-2 items-center">
                    <Badge variant="secondary">{s.status}</Badge>
                    {cls && <span>{cls}</span>}
                    <span>
                      {termLabels?.[s.term] || s.term} {s.year}
                    </span>
                    {s.examType?.name && <span>{s.examType.name}</span>}
                  </div>
                </div>

                <Button
                  variant={isActive ? "default" : "secondary"}
                  aria-expanded={isActive}
                  onClick={() => (isActive && onClose ? onClose() : onOpen(s.id))}
                >
                  {isActive ? (onClose ? "Close" : "Opened ↓") : "Open"}
                </Button>
              </CardContent>
            </Card>
            {isActive && detail && <div className="p-3 pt-4">{detail}</div>}
          </div>
        );
      })}
    </div>
  );
}
