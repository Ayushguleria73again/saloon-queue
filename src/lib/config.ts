export const APP_CONFIG = {
  appName: "SalonFlow",
  defaultTimezone: "Asia/Kolkata",
  defaultDayResetTime: "00:00",
  defaultTokenPrefix: "A",
  defaultPushThresholds: [3, 1] as const,
  paginationMaxLimit: 50,
  slowQueryWarnMs: 100,
  apiSloMs: {
    publicReadP95: 80,
    ownerMutationP95: 100,
    tokenCreateP95: 150,
  },
} as const;
