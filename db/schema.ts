import { integer, sqliteTable, text, primaryKey, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const journalHeads = sqliteTable('journal_heads', {
  ownerId: text('owner_id').primaryKey().notNull(),
  journalId: text('journal_id').notNull(),
  createdAt: text('created_at').notNull(),
  revision: integer('revision').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [check('journal_heads_revision_nonnegative', sql`${table.revision} >= 0`)]);

export const journalEvents = sqliteTable('journal_events', {
  ownerId: text('owner_id').notNull().references(() => journalHeads.ownerId),
  eventIndex: integer('event_index').notNull(),
  eventId: text('event_id').notNull(),
  eventJson: text('event_json').notNull(),
  receivedAt: text('received_at').notNull(),
}, table => [
  primaryKey({ columns: [table.ownerId, table.eventIndex] }),
  uniqueIndex('journal_events_owner_event_unique').on(table.ownerId, table.eventId),
  check('journal_events_index_nonnegative', sql`${table.eventIndex} >= 0`),
]);
