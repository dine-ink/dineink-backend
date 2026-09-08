/**
 * Moved to `src/shared/validate` so the restaurant-facing modules can use the
 * same toolkit — this file is a re-export so the internal modules already
 * importing from here keep working.
 */
export * from "../../../shared/validate";
