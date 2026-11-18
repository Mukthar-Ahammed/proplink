-- Rollback for 20261118150000_phase2_notification_deliveries.
-- The delivery log is lost; announcements already sent could be sent again.
DROP TABLE IF EXISTS public.notification_deliveries;
DROP TYPE IF EXISTS public."NotificationDeliveryStatus";
