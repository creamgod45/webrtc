-- Fix User model constraints
-- Run this with: psql -U webrtc_voice -d webrtc_voice -f fix-user-constraint.sql

-- Drop the incorrect unique constraint on user_id
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_user_id_key;

-- Add the correct composite unique constraint (user_id + room_id)
-- This allows same user_id in different rooms but not in the same room
CREATE UNIQUE INDEX IF NOT EXISTS unique_user_per_room ON users (user_id, room_id);

-- Verify the changes
\d users
