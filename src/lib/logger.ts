import { env } from "@/config/env";
import fs from "fs";
import path from "path";

type LogLevel = "info" | "warn" | "error" | "debug";

class Logger {
  private logfile: string | undefined;

  constructor() {
    this.logfile = env.LOG_FILE_PATH;
  }

  private formatMessage(level: LogLevel, message: unknown) {
    const formattedMessage =
      typeof message === "string" ? message : message?.toString() ?? undefined;
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level.toUpperCase()}] ${formattedMessage}`;
  }

  private writeToFile(formatted: string) {
    if (this.logfile) {
      try {
        fs.mkdirSync(path.dirname(this.logfile), { recursive: true });
        fs.appendFileSync(this.logfile, formatted + "\n", { encoding: "utf8" });
      } catch (err) {
        // fallback: print error to console
        console.error("[Logger] Failed to write log file:", err);
      }
    }
  }

  info(message: unknown) {
    const formatted = this.formatMessage("info", message);
    console.info(formatted);
    this.writeToFile(formatted);
  }

  warn(message: unknown) {
    const formatted = this.formatMessage("warn", message);
    console.warn(formatted);
    this.writeToFile(formatted);
  }

  error(message: unknown) {
    const formatted = this.formatMessage("error", message);
    console.error(formatted);
    this.writeToFile(formatted);
  }

  debug(message: unknown) {
    const formatted = this.formatMessage("debug", message);
    console.debug(formatted);
    this.writeToFile(formatted);
  }
}

export const logger = new Logger();
