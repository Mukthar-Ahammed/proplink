-- Rollback for 20261118050000_phase1_secure_uploads.
-- Drops upload records and settings. Stored objects are NOT deleted: remove
-- the quarantine and private bucket contents separately if required.
DROP TABLE IF EXISTS public.upload_settings;
DROP TABLE IF EXISTS public.uploaded_files;
DROP TYPE IF EXISTS public."UploadStatus";
