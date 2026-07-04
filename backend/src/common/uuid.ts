/** True for a canonical 8-4-4-4-12 hex UUID shape (any version). Callers use this to short-circuit
 *  a lookup to 404 instead of letting Postgres throw on an invalid `uuid` column comparison. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidShaped(value: string): boolean {
  return UUID_SHAPE.test(value);
}
