-- Audit log immutability, enforced by the database rather than by convention.
--
-- The application already exposes no update or delete path for InternalAuditLog
-- — but "we didn't write the endpoint" is not the same as "it cannot happen".
-- An ORM call, a migration, a console session, or a future endpoint added by
-- someone who did not know the rule would all succeed today. An audit trail
-- that can be quietly rewritten answers no question it exists to answer.
--
-- WHAT THIS DOES
--   A BEFORE UPDATE OR DELETE trigger that raises an exception. Any statement
--   touching an existing row fails and the surrounding transaction rolls back.
--   INSERT is untouched, so writing audit entries is unaffected.
--
-- WHAT THIS DOES NOT DO
--   It does not stop a superuser. Anyone with ALTER privileges can drop the
--   trigger, and on a managed instance (this runs on AWS RDS) the application
--   role is not superuser but the master user is. Genuine tamper-evidence
--   needs either append-only storage outside the database or a hash chain
--   where each row commits to its predecessor.
--
--   The hash chain is the stronger option and is deliberately not implemented
--   here: it changes the write path for every audited action, needs a
--   verification job to be worth anything, and wants its own review. This
--   trigger is the strongest thing that is safe to add without that.
--
--   Dropping the trigger is itself a schema change, so it shows up in a
--   migration diff — which is the point. Tampering stops being something that
--   leaves no trace.

CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION
        'InternalAuditLog is append-only. % on audit row id=% was refused.',
        TG_OP,
        COALESCE(OLD."id"::text, '?')
        USING ERRCODE = 'restrict_violation',
              HINT = 'Audit history cannot be edited or deleted. Correct the record by writing a new entry describing the correction.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS internal_audit_log_immutable ON "InternalAuditLog";

CREATE TRIGGER internal_audit_log_immutable
    BEFORE UPDATE OR DELETE ON "InternalAuditLog"
    FOR EACH ROW
    EXECUTE FUNCTION reject_audit_mutation();

-- The same protection for the two other records that exist to be evidence.
--
-- InternalLoginAttempt is how a brute-force attempt is reconstructed after the
-- fact; ApplicationLog is what a correlation id resolves to. Both are useless
-- if the thing being investigated can erase them.

DROP TRIGGER IF EXISTS internal_login_attempt_immutable ON "InternalLoginAttempt";

CREATE TRIGGER internal_login_attempt_immutable
    BEFORE UPDATE OR DELETE ON "InternalLoginAttempt"
    FOR EACH ROW
    EXECUTE FUNCTION reject_audit_mutation();

-- ApplicationLog is deliberately NOT made immutable.
--
-- It is operational debris rather than evidence: it grows without bound and
-- will need a retention policy that deletes old rows. Locking it would mean
-- that policy could not be implemented without first dropping the trigger,
-- which trains people to drop triggers. Evidence and debris get different
-- treatment on purpose.
