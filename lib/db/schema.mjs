// The app's tables (Drizzle; ticket #318). After a change here: `npm run db:generate` writes the next numbered
// SQL file in migrations/ (commit it; never edit the journal by hand), and the server applies it when it starts.
// Times are timestamptz with the app's millisecond clock (Date.now()): a map's updated_at is also its version
// (`v`, what a room and a record's map_version say), so it must come back exactly as it went in.
import { bigint, doublePrecision, index, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

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
