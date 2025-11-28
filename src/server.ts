import express, { Application } from "express";
import { env } from "@/config/env";
import { runScheduler } from "@/lib/cron/scheduler";
import dynamicRoutes from "@/routes/dynamic-routes";

const app: Application = express();

app.use(express.json());

// route files
app.get("/favicon.ico", (req, res) => res.status(204));
app.use("/", dynamicRoutes);

const server = app.listen(
  env.PORT,
  env.HOST,
  console.log(
    `Server running in ${env.NODE_ENV} mode on host ${env.HOST} and port ${env.PORT} with PID ${process.pid}`
  ) as never
);

// Handle unhandled promise rejections
process.on("unhandledRejection", (err: { message: string }) => {
  console.log(`Error: ${err.message}`);
  // close server & exit process
  server.close(() => process.exit(1));
});

process.on("uncaughtException", (err: { message: string }) => {
  console.log(`Error: ${err.message}`);
  // close server & exit process
  server.close(() => process.exit(1));
});

process.on("SIGTERM", (err: { message: string }) => {
  console.log(`Error: ${err.message}`);
  // close server & exit process
  server.close(() => process.exit(1));
});

// start cron scheduler
runScheduler();
