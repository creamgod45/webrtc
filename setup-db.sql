-- PostgreSQL Database Setup Script
-- Run this script as a superuser (postgres) to set up the database and permissions

-- Create database (if not exists)
-- Note: You may need to run this separately if the database doesn't exist yet
-- CREATE DATABASE webrtc_voice;

-- Connect to the database first, then run the following:
-- \c webrtc_voice

-- Grant permissions to your user (replace 'your_username' with your actual PostgreSQL username)
-- If you're using the default 'postgres' user, you can skip this

-- Option 1: Grant all privileges on schema public to your user
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO postgres;

-- Option 2: If you have a different username, uncomment and modify these lines:
-- GRANT ALL ON SCHEMA public TO your_username;
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO your_username;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO your_username;

-- Grant future privileges
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;

-- Enable UUID extension (required for our UUID fields)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Verify permissions
\dp
