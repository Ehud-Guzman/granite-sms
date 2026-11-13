import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fmtClass } from "../utils/format";
import ExamGroups from "@/features/exams/components/ExamGroups";

// The exam list. Once an exam is open the list folds down to that one exam
// (with a way back), so its results sit right under it instead of below every
// other exam. When `detail` is given it shows inside the opened card.
export default function SessionsList({ sessions, activeSessionId, onOpen, onClose, classLabelById, termLabels, detail }) {
  const open = activeSessionId && sessions.some((s) => s.id === activeSessionId);
  const shown = open ? sessions.filter((s) => s.id === activeSessionId) : sessions;
  const labelOf = (s) => classLabelById.get(s.classId) || (s.class ? fmtClass(s.class) : "Class");

  // Nothing open: exams grouped by term, each class inside its exam.
  if (!open) {
    return (
      <ExamGroups
        sessions={sessions}
        termLabels={termLabels}
        classLabelOf={labelOf}
        emptyText="No published exams for these filters."
        renderAction={(s) => (
          <Button size="sm" variant="secondary" onClick={() => onOpen(s.id)}>
            Open
          </Button>
        )}
      />
    );
  }

  return (
    <div className="grid gap-3">
      {open && onClose && (
        <button type="button" onClick={onClose} className="justify-self-start text-sm font-medium text-primary hover:underline">
          ← All exams ({sessions.length})
        </button>
      )}
      {shown.map((s) => {
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
