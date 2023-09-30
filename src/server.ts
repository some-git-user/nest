import errorHandler from '@/lib/middleware/errorHandler';
import express, { Application } from 'express';
import { env } from '@/config/env';
import { runScheduler } from '@/lib/cron/scheduler';
import connectMongoDB from '@/lib/db/mongodb';
import images from '@/routes/images';

// connect database
connectMongoDB();

const app: Application = express();

app.use(express.json());

// route files
app.use('/api/v1/image', images);

// init errorHandlerToClient - to send individuel res to client
app.use(errorHandler);

const server = app.listen(
    env.PORT,
  console.log(
      `Server running in ${env.NODE_ENV} mode on port ${env.PORT} with PID ${process.pid}`,
  ) as never,
);

// Handle unhandled promise rejections - dont use try catch at db.js
process.on('unhandledRejection', (err: { message: string }) => {
    console.log(`Error: ${err.message}`);
    // close server & exit process
    server.close(() => process.exit(1));
});

process.on('uncaughtException', (err: { message: string }) => {
    console.log(`Error: ${err.message}`);
    // close server & exit process
    server.close(() => process.exit(1));
});

process.on('SIGTERM', (err: { message: string }) => {
    console.log(`Error: ${err.message}`);
    // close server & exit process
    server.close(() => process.exit(1));
});

// start cron scheduler
runScheduler();