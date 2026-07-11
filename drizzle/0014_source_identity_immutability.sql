CREATE TRIGGER `trg_source_entity_identities_bound`
BEFORE INSERT ON `source_entity_identities`
WHEN (
  SELECT COUNT(*) FROM `source_entity_identities`
  WHERE `source_entity_id` = NEW.`source_entity_id`
) >= 32
BEGIN
  SELECT RAISE(ABORT, 'source entity identity bound is exhausted');
END;--> statement-breakpoint
CREATE TRIGGER `trg_source_entity_identities_no_update`
BEFORE UPDATE ON `source_entity_identities`
BEGIN
  SELECT RAISE(ABORT, 'source entity identities are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `trg_source_entity_identities_no_delete`
BEFORE DELETE ON `source_entity_identities`
BEGIN
  SELECT RAISE(ABORT, 'source entity identities are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `trg_source_identity_conflicts_no_update`
BEFORE UPDATE ON `source_identity_conflicts`
BEGIN
  SELECT RAISE(ABORT, 'source identity conflicts are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `trg_source_identity_conflicts_no_delete`
BEFORE DELETE ON `source_identity_conflicts`
BEGIN
  SELECT RAISE(ABORT, 'source identity conflicts are append-only');
END;
