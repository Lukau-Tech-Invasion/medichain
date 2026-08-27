-- The compatibility identity layer issues professional contexts against these
-- explicit legacy boundary identifiers. Persist the same boundary so durable
-- devices and emergency grants can satisfy their foreign keys while the full
-- organization-assignment migration remains additive.
INSERT INTO organizations (id, name, organization_type, status)
VALUES ('legacy-organization', 'MediChain legacy deployment', 'healthcare_provider', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO facilities (id, organization_id, name, facility_type, status)
VALUES ('legacy-facility', 'legacy-organization', 'MediChain legacy facility', 'healthcare', 'active')
ON CONFLICT (id) DO NOTHING;
