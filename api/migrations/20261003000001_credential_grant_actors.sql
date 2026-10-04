-- Keep the actor-column registry in step with the credential grants table.
-- Both columns already have foreign keys to users(id); no historical row is rewritten.
INSERT INTO actor_column_registry (table_name, column_name, kind, fk) VALUES
    ('credential_grants', 'user_id', 'uuid_fk', 'users.id'),
    ('credential_grants', 'issued_by', 'uuid_fk', 'users.id');
