'use client';

/**
 * A select that submits its form as soon as it changes. Needs to be a client
 * component: an onChange handler can't cross the server/client boundary, and a
 * server component rendering one fails at request time rather than at build.
 */
export function AutoSubmitSelect({
  id,
  name,
  defaultValue,
  options,
  emptyLabel,
}: {
  id: string;
  name: string;
  defaultValue: string;
  options: Array<{ value: string; label: string }>;
  emptyLabel: string;
}) {
  return (
    <select
      id={id}
      name={name}
      defaultValue={defaultValue}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
    >
      <option value="">{emptyLabel}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
