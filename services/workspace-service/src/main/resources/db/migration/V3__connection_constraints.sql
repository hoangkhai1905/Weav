ALTER TABLE connections
    ADD COLUMN name_normalized VARCHAR(255);

UPDATE connections
SET name_normalized =
    lower(
        regexp_replace(
            btrim(
                name,
                chr(1) || chr(2) || chr(3) || chr(4) || chr(5) || chr(6) || chr(7)
                    || chr(8) || chr(9) || chr(10) || chr(11) || chr(12) || chr(13)
                    || chr(14) || chr(15) || chr(16) || chr(17) || chr(18) || chr(19)
                    || chr(20) || chr(21) || chr(22) || chr(23) || chr(24) || chr(25)
                    || chr(26) || chr(27) || chr(28) || chr(29) || chr(30) || chr(31)
                    || chr(32)
            ),
            '\s+',
            ' ',
            'g'
        )
    );

ALTER TABLE connections
    ALTER COLUMN name_normalized SET NOT NULL;

CREATE UNIQUE INDEX uk_connections_workspace_name_normalized
    ON connections (workspace_id, name_normalized);
