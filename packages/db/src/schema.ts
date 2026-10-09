import { sqliteTable, text, primaryKey, index } from 'drizzle-orm/sqlite-core';

export const records = sqliteTable('records', {
 kind: text('kind').notNull(), id: text('id').notNull(),
 projectId: text('project_id'), taskId: text('task_id'),
 status: text('status'), body: text('body').notNull(),
 updatedAt: text('updated_at').notNull()
}, table => [
 primaryKey({ columns: [table.kind, table.id] }),
 index('idx_records_project').on(table.kind, table.projectId),
 index('idx_records_task').on(table.kind, table.taskId),
 index('idx_records_status').on(table.kind, table.status)
]);
export const settings = sqliteTable('settings', {
 key: text('key').primaryKey(), value: text('value').notNull()
});
export const auditLog = sqliteTable('audit_log', {
 id: text('id').primaryKey(), projectId: text('project_id').notNull(),
 taskId: text('task_id'), action: text('action').notNull(), actor: text('actor').notNull(),
 channel: text('channel').notNull(), at: text('at').notNull(), body: text('body').notNull()
}, table => [index('idx_audit_project').on(table.projectId), index('idx_audit_task').on(table.taskId)]);
