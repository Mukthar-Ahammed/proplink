BEGIN;

DO $$
DECLARE
  resale_table regclass := to_regclass('public."FlipperResale"');
  property_table regclass := to_regclass('public."Property"');
  resale_property_attnum smallint;
  property_id_attnum smallint;
  constraint_valid boolean;
BEGIN
  IF resale_table IS NULL THEN
    RAISE EXCEPTION 'public."FlipperResale" is missing; apply 20261007100000_phase8_flipper_resale first';
  END IF;
  IF property_table IS NULL THEN
    RAISE EXCEPTION 'public."Property" is missing';
  END IF;

  SELECT attnum INTO resale_property_attnum
  FROM pg_attribute
  WHERE attrelid = resale_table
    AND attname = 'resalePropertyId'
    AND attnum > 0
    AND NOT attisdropped;

  IF resale_property_attnum IS NULL THEN
    ALTER TABLE public."FlipperResale"
      ADD COLUMN IF NOT EXISTS "resalePropertyId" TEXT;
  END IF;

  SELECT attnum INTO resale_property_attnum
  FROM pg_attribute
  WHERE attrelid = resale_table
    AND attname = 'resalePropertyId'
    AND attnum > 0
    AND NOT attisdropped
    AND atttypid = 'pg_catalog.text'::regtype;

  IF resale_property_attnum IS NULL THEN
    RAISE EXCEPTION 'public."FlipperResale"."resalePropertyId" must be TEXT';
  END IF;

  SELECT attnum INTO property_id_attnum
  FROM pg_attribute
  WHERE attrelid = property_table
    AND attname = 'id'
    AND attnum > 0
    AND NOT attisdropped
    AND atttypid = 'pg_catalog.text'::regtype;

  IF property_id_attnum IS NULL THEN
    RAISE EXCEPTION 'public."Property"."id" must be TEXT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."FlipperResale"
    WHERE "resalePropertyId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public."Property"
        WHERE "Property"."id" = "FlipperResale"."resalePropertyId"
      )
  ) THEN
    RAISE EXCEPTION 'Orphan resalePropertyId values exist; inspect and resolve them before catch-up';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."FlipperResale"
    WHERE "resalePropertyId" IS NOT NULL
    GROUP BY "resalePropertyId"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate resalePropertyId values exist; inspect and resolve them before catch-up';
  END IF;

  SELECT
    c.contype = 'u'
    AND cardinality(c.conkey) = 1
    AND c.conkey[1] = resale_property_attnum
  INTO constraint_valid
  FROM pg_constraint c
  WHERE c.conrelid = resale_table
    AND c.conname = 'FlipperResale_resalePropertyId_key';

  IF constraint_valid IS NULL THEN
    ALTER TABLE public."FlipperResale"
      ADD CONSTRAINT "FlipperResale_resalePropertyId_key"
      UNIQUE ("resalePropertyId");
  ELSIF NOT constraint_valid THEN
    RAISE EXCEPTION 'Existing FlipperResale_resalePropertyId_key does not match the expected unique constraint';
  END IF;

  SELECT
    c.contype = 'f'
    AND cardinality(c.conkey) = 1
    AND c.conkey[1] = resale_property_attnum
    AND c.confrelid = property_table
    AND cardinality(c.confkey) = 1
    AND c.confkey[1] = property_id_attnum
    AND c.confdeltype = 'n'
    AND c.confupdtype = 'c'
  INTO constraint_valid
  FROM pg_constraint c
  WHERE c.conrelid = resale_table
    AND c.conname = 'FlipperResale_resalePropertyId_fkey';

  IF constraint_valid IS NULL THEN
    ALTER TABLE public."FlipperResale"
      ADD CONSTRAINT "FlipperResale_resalePropertyId_fkey"
      FOREIGN KEY ("resalePropertyId")
      REFERENCES public."Property"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  ELSIF NOT constraint_valid THEN
    RAISE EXCEPTION 'Existing FlipperResale_resalePropertyId_fkey does not match the expected foreign key';
  END IF;
END
$$;

COMMIT;
