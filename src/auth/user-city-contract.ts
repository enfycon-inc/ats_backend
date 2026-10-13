export const USER_CITY_OPTIONS = [
  { value: 'BBSR', label: 'Bhubaneswar' },
  { value: 'PUNE', label: 'Pune' },
  { value: 'BENGALURU', label: 'Bengaluru' },
  { value: 'VIZAG', label: 'Vizag' },
  { value: 'HYDERABAD', label: 'Hyderabad' },
] as const;

export type UserCity = typeof USER_CITY_OPTIONS[number]['value'];
export const USER_CITY_VALUES: readonly string[] = USER_CITY_OPTIONS.map(option => option.value);
