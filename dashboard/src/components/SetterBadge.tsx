/**
 * A person's name always wears the same colour, so who owns what is readable
 * without stopping to read. Unowned is deliberately loud rather than blank.
 */
export function SetterBadge({
  name,
  color,
  fallback = 'Unassigned',
}: {
  name?: string | null;
  color?: string | null;
  fallback?: string;
}) {
  if (!name) return <span className="pill warn">{fallback}</span>;
  return (
    <span className="pill setter-badge" data-color={color ?? 'grey'}>
      {name}
    </span>
  );
}
