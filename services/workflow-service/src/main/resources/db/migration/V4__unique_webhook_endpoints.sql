DO $$
DECLARE
    duplicate_count BIGINT;
BEGIN
    SELECT COUNT(*)
      INTO duplicate_count
      FROM (
          SELECT endpoint_key
            FROM workflow_triggers
           WHERE endpoint_key IS NOT NULL
           GROUP BY endpoint_key
          HAVING COUNT(*) > 1
      ) AS duplicate_endpoints;

    IF duplicate_count > 0 THEN
        RAISE EXCEPTION
            'Cannot create the unique webhook endpoint index: % duplicate endpoint identifiers require explicit data repair',
            duplicate_count;
    END IF;
END $$;

CREATE UNIQUE INDEX uq_workflow_triggers_endpoint_key
    ON workflow_triggers (endpoint_key)
    WHERE endpoint_key IS NOT NULL;
