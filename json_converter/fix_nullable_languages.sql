-- Fix NULL constraints for language tables
-- Some items don't have all languages, so we need to allow NULL values
-- Run this script in Supabase SQL Editor to fix existing tables

-- English items
ALTER TABLE en_items ALTER COLUMN en DROP NOT NULL;

-- Japanese items
ALTER TABLE ja_items ALTER COLUMN ja DROP NOT NULL;

-- German items
ALTER TABLE de_items ALTER COLUMN de DROP NOT NULL;

-- French items
ALTER TABLE fr_items ALTER COLUMN fr DROP NOT NULL;
