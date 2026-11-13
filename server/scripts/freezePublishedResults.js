// Saves frozen copies for exam sessions published before frozen results
// existed (audit H9). Until it runs, those sessions are still shown, just
// calculated live. Safe to re-run: sessions that already have a copy are
// skipped.
//
//   node scripts/freezePublishedResults.js          # list what would be frozen
//   node scripts/freezePublishedResults.js --write  # freeze them
import dotenv from "dotenv";
dotenv.config();

const { prisma } = await import("../src/lib/prisma.js");
const { writeResultSnapshot } = await import("../src/modules/exams/exams.services.js");
const WRITE = process.argv.includes("--write");

const sessions = await prisma.examSession.findMany({
  where: { status: "PUBLISHED", publish: null },
  select: { id: true, schoolId: true, classId: true, year: true, term: true, name: true, publishedAt: true, publishedById: true, createdByUserId: true },
  orderBy: [{ schoolId: "asc" }, { year: "asc" }, { term: "asc" }],
});

console.log(`${sessions.length} published session(s) without a frozen copy.`);
if (!WRITE) {
  for (const s of sessions.slice(0, 20)) console.log(`  ${s.schoolId}  ${s.year} ${s.term}  ${s.name || s.id}`);
  if (sessions.length) console.log("\nNothing changed. Re-run with --write to freeze them as they are now.");
  process.exit(0);
}

let n = 0;
for (const s of sessions) {
  const count = await prisma.$transaction(
    (tx) =>
      writeResultSnapshot(tx, {
        schoolId: s.schoolId,
        session: s,
        publishedById: s.publishedById || s.createdByUserId,
        publishedAt: s.publishedAt,
      }),
    { maxWait: 10_000, timeout: 60_000 }
  );
  n += 1;
  console.log(`  froze ${s.year} ${s.term} ${s.name || s.id}: ${count} student(s)`);
}
console.log(`\nFroze ${n} session(s).`);
await prisma.$disconnect();
