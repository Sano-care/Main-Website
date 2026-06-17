-- Founder directive 2026-06-17: clear the Medic Directory before Hub ships.
-- The Add-Medic flow becomes the first post-deploy act + doubles as real-world
-- UAT of that feature.
--
-- DELETE (not TRUNCATE) so BIGSERIAL/autoincrement state stays clean for
-- M055's medic_doc_access_log.id. CASCADE handles attendance + pings.
-- medic_event_log (M052) just created, empty. M055-M057 tables don't exist
-- yet at run time. paramedics table dropped via M054.
--
-- Applied 2026-06-17 via execute_sql MCP (data wipe, not schema). Pre-wipe
-- snapshot: 568 pings (UAT generated more than initial 188 spot-check during
-- polish session), 5 attendance, 4 medics. Post-wipe: 0/0/0.

DELETE FROM medic_location_pings;
DELETE FROM medic_attendance;
DELETE FROM medics;
