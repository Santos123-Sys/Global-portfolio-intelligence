import { pgTable, uuid, text, timestamp, jsonb, numeric, integer, index } from 'drizzle-orm/pg-core';
import { securities, users } from './schema';

export const agentAnalysisSessions = pgTable('agent_analysis_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  securityId: uuid('security_id').notNull().references(() => securities.id, { onDelete: 'cascade' }),
  sessionType: text('session_type').notNull(),
  status: text('status').notNull().default('queued'),
  phase: text('phase').notNull().default('research'),
  requestPayload: jsonb('request_payload').notNull(),
  finalOutput: jsonb('final_output'),
  error: text('error'),
  attempts: integer('attempts').notNull().default(0),
  leaseOwner: uuid('lease_owner'),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  evidenceSnapshot: jsonb('evidence_snapshot'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  accuracyScore: numeric('accuracy_score', { precision: 5, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('agent_sessions_owner_security_idx').on(t.ownerId, t.securityId), index('agent_sessions_queue_idx').on(t.status, t.updatedAt)]);

export const agentRuns = pgTable('agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => agentAnalysisSessions.id, { onDelete: 'cascade' }),
  agentName: text('agent_name').notNull(), agentRole: text('agent_role').notNull(),
  inputPayload: jsonb('input_payload').notNull(), outputPayload: jsonb('output_payload'),
  reasoningChain: text('reasoning_chain'), confidenceScore: numeric('confidence_score', { precision: 5, scale: 2 }),
  executionTimeMs: integer('execution_time_ms'), status: text('status').notNull().default('running'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, t => [index('agent_runs_session_idx').on(t.sessionId)]);

export const agentMemoryEvents = pgTable('agent_memory_events', {
  id: uuid('id').primaryKey().defaultRandom(), ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  securityId: uuid('security_id').references(() => securities.id, { onDelete: 'cascade' }),
  agentName: text('agent_name').notNull(), memoryType: text('memory_type').notNull(), eventType: text('event_type').notNull(),
  eventContent: jsonb('event_content').notNull(), relevanceScore: numeric('relevance_score', { precision: 5, scale: 2 }),
  decayRateHours: numeric('decay_rate_hours', { precision: 10, scale: 2 }).default('168'),
  expiresAt: timestamp('expires_at', { withTimezone: true }), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('agent_memory_owner_idx').on(t.ownerId, t.securityId)]);

export const agentBeliefUpdates = pgTable('agent_belief_updates', {
  id: uuid('id').primaryKey().defaultRandom(), ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  agentName: text('agent_name').notNull(), beliefCategory: text('belief_category').notNull(),
  previousBelief: text('previous_belief'), updatedBelief: text('updated_belief'), updateReason: text('update_reason'),
  performanceDelta: numeric('performance_delta', { precision: 10, scale: 4 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const agentDebates = pgTable('agent_debates', {
  id: uuid('id').primaryKey().defaultRandom(), sessionId: uuid('session_id').notNull().references(() => agentAnalysisSessions.id, { onDelete: 'cascade' }),
  bullArgument: text('bull_argument').notNull(), bearArgument: text('bear_argument').notNull(), judgeReasoning: text('judge_reasoning').notNull(),
  finalScore: jsonb('final_score').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
