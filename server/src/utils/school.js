// src/utils/school.js
export function resolveSchoolId(req) {
  return (
    req.user?.schoolId ||               // future-proof (if you later add schoolId to JWT)
    req.headers["x-school-id"] ||       // MVP: allow this header for demos/testing
    req.query.schoolId ||               // optional fallback
    null
  );
}
