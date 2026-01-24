// src/modules/exams/exams.utils.js
export function buildAuditPayload({ action, entityType, entityId, before, after, actorUserId }) {
  return {
    action,
    entityType,
    entityId,
    actorUserId,
    before: before ?? undefined,
    after: after ?? undefined,
  };
}
