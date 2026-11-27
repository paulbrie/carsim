// The app's tables (Drizzle; ticket #318). After a change here: `npm run db:generate` writes the next numbered
// SQL file in migrations/ (commit it; never edit the journal by hand), and the server applies it when it starts.
// Times are timestamptz with the app's millisecond clock (Date.now()): a map's updated_at is also its version
// (`v`, what a room and a record's map_version say), so it must come back exactly as it went in.
import { bigint, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

const at = name => timestamp(name, { withTimezone: true, precision: 3, mode: 'date' });

/** The race maps (lib/maps/store.mjs). course: the sim's COURSE; null stands for its own figure-8. */
export const maps = pgTable('maps', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  course: jsonb('course'),
  createdAt: at('created_at').notNull(),
  updatedAt: at('updated_at').notNull(),
  updatedBy: text('updated_by'),
});

/**
 * Best laps (lib/race/records.mjs): each driver's fastest valid lap per map, ground and car.
 * map is not a foreign key: the built-in figure-8 has no row until it is edited, and a deleted map keeps its times.
 * trace: the lap's path for the ghost car (base64, see GHOST), null without one.
 * A network's laps (#333) are records too, of a driver of their own: driver_id `tnn:<autopilot id>` (a saved network)
 * or `tnn:local:<user id>` (one not saved, of whoever drove it), driver_name the network's, and net saying so.
 */
export const records = pgTable('records', {
  map: text('map').notNull(),
  ground: text('ground').notNull(),
  vehicle: text('vehicle').notNull(),
  driverId: text('driver_id').notNull(),
  driverName: text('driver_name').notNull(),
  driverImage: text('driver_image'),
  mapVersion: bigint('map_version', { mode: 'number' }).notNull(),
  time: doublePrecision('time_s').notNull(),
  splits: jsonb('splits').notNull(),
  setAt: at('set_at').notNull(),
  trace: text('trace'),
  // a network's lap (#333): { autopilot: saved id or null, name, creator, weights, h }; null: a human's
  net: jsonb('net'),
}, t => [
  primaryKey({ columns: [t.map, t.ground, t.vehicle, t.driverId] }),
  index('records_board').on(t.map, t.ground, t.time),
]);

/** Saved autopilots (lib/autopilots/store.mjs). training: the sim's network as cleanTraining leaves it. */
export const autopilots = pgTable('autopilots', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  owner: text('owner').notNull(),
  ownerName: text('owner_name').notNull(),
  savedAt: at('saved_at').notNull(),
  training: jsonb('training').notNull(),
}, t => [index('autopilots_owner').on(t.owner)]);

/** Odds and ends the server remembers, e.g. that the files of before the database were imported (import-files.mjs). */
export const appMeta = pgTable('app_meta', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  at: at('at').notNull(),
});

/**
 * The main chat room's messages (lib/race/chat.mjs; ticket #325): the last CHAT_LIMITS.keep are kept. A race room's
 * chat is not here: it lasts as long as the room, in the race server's memory.
 */
export const chatMessages = pgTable('chat_messages', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  userName: text('user_name').notNull(),
  userImage: text('user_image'),
  text: text('text').notNull(),
  at: at('at').notNull(),
}, t => [index('chat_messages_at').on(t.at)]);

/** Who may not write in the chats, until when (the super admin mutes; lib/race/chat.mjs). */
export const chatMutes = pgTable('chat_mutes', {
  userId: text('user_id').primaryKey(),
  userName: text('user_name').notNull(),
  until: at('until').notNull(),
  by: text('by').notNull(),
});

/**
 * Agents' accounts (lib/agents/store.mjs): an AI agent signs itself up and gets a key; its user id is `agent:<id>` (its
 * networks' owner). Only hashes are kept: of the key, of the code its human owner claims it with (null once claimed),
 * and of the address it signed up from (to count sign-ups). owner: the user who claimed it, null until then.
 */
export const agents = pgTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  nameKey: text('name_key').notNull().unique(),
  keyHash: text('key_hash').notNull().unique(),
  keyAt: at('key_at').notNull(),
  claimHash: text('claim_hash'),
  createdAt: at('created_at').notNull(),
  createdFrom: text('created_from').notNull(),
  seenAt: at('seen_at'),
  owner: text('owner'),
  ownerName: text('owner_name'),
  claimedAt: at('claimed_at'),
}, t => [index('agents_owner').on(t.owner), index('agents_created').on(t.createdAt)]);

/**
 * The people who signed in (lib/admin/store.mjs; ticket #357): the super admin's dashboard lists them. Written at each sign-in
 * (auth.ts's jwt callback) and, every ten minutes at most, when they are seen (last_at). id: the session's user id
 * (`google:<sub>`, `guest:<uuid>`); email: Google's (a guest has none).
 */
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  name: text('name').notNull(),
  email: text('email'),
  image: text('image'),
  firstAt: at('first_at').notNull(),
  lastAt: at('last_at').notNull(),
  signIns: integer('sign_ins').notNull().default(1),
}, t => [index('users_last').on(t.lastAt)]);

/**
 * Every network an agent sent in to be timed (lib/admin/store.mjs, app/api/agents/me/networks; ticket #357), whatever came of
 * it: time (its lap) and autopilot (the network saved), or why there was no lap, or the error. ms: how long it took.
 */
export const examRuns = pgTable('exam_runs', {
  id: text('id').primaryKey(),
  at: at('at').notNull(),
  agent: text('agent').notNull(),
  agentName: text('agent_name').notNull(),
  name: text('name').notNull(),
  track: text('track').notNull(),
  ground: text('ground').notNull(),
  vehicle: text('vehicle').notNull(),
  time: doublePrecision('time_s'),
  why: text('why'),
  seconds: doublePrecision('seconds'),
  error: text('error'),
  status: integer('status').notNull(),
  ms: integer('ms').notNull(),
  autopilot: text('autopilot'),
  build: text('build'),
}, t => [index('exam_runs_at').on(t.at), index('exam_runs_agent').on(t.agent)]);

/**
 * The arm sim's saved networks (lib/arm/store.mjs; ticket #362): a person's trained network for one arm and one scenario.
 * net: the network as the page has it (lib/arm/core.mjs: { kind, arm, task, control, roll, inputs, h, w, ... }), checked by
 * notNet; exam: the exam as the saver's browser ran it ({ done, of, time }; null: not examined), not the server's. Apart
 * from autopilots (the car's) so the car's pages, boards and exams never see them (#359 plans a `sim` column for both).
 */
export const armNetworks = pgTable('arm_networks', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  owner: text('owner').notNull(),
  ownerName: text('owner_name').notNull(),
  savedAt: at('saved_at').notNull(),
  arm: text('arm').notNull(),
  task: text('task').notNull(),
  weights: integer('weights').notNull(),
  net: jsonb('net').notNull(),
  exam: jsonb('exam'),
}, t => [index('arm_networks_owner').on(t.owner), index('arm_networks_arm_task').on(t.arm, t.task)]);
