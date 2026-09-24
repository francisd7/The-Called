/**
 * The things a monthly target can be set against.
 *
 * Its own module because the actions file is 'use server', which may only
 * export async functions - a plain array there fails the build.
 */
export const TARGET_METRICS = [
  { key: 'calls', label: 'Calls booked', money: false },
  { key: 'cash', label: 'Cash collected', money: true },
] as const;

export type TargetMetric = (typeof TARGET_METRICS)[number]['key'];
