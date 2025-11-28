import cron from "node-cron";

import { cronTimeZone } from "@/lib/cron/scheduler";

// # ┌────────────── second (optional)
// # │ ┌──────────── minute
// # │ │ ┌────────── hour
// # │ │ │ ┌──────── day of month
// # │ │ │ │ ┌────── month
// # │ │ │ │ │ ┌──── day of week
// # │ │ │ │ │ │
// # │ │ │ │ │ │
// # * * * * * *
export const scheduleCleanupLogs = () => {
  cron.schedule(
    "0 0 * * *", // run every day at 00:00
    () => {
      cleanupLogs();
    },
    { timezone: cronTimeZone }
  );
};

const cleanupLogs = async () => {
  console.debug("cleanup logs");
};
