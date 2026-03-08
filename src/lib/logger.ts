/**
 * Structured logging utility.
 * Outputs JSON logs to stdout for consumption by log aggregators.
 * In development, falls back to readable console output.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  [key: string]: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MIN_LEVEL = LOG_LEVELS[(process.env.LOG_LEVEL as LogLevel) || "info"];
const IS_PRODUCTION = process.env.NODE_ENV === "production";

function emit(entry: LogEntry) {
  if (LOG_LEVELS[entry.level] < MIN_LEVEL) return;

  if (IS_PRODUCTION) {
    // Structured JSON for log aggregators
    const output = JSON.stringify(entry);
    if (entry.level === "error") {
      process.stderr.write(output + "\n");
    } else {
      process.stdout.write(output + "\n");
    }
  } else {
    // Readable format for development
    const { level, message, timestamp, ...rest } = entry;
    const extra = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : "";
    const prefix = `[${timestamp}] ${level.toUpperCase()}:`;
    if (level === "error") {
      console.error(`${prefix} ${message}${extra}`);
    } else if (level === "warn") {
      console.warn(`${prefix} ${message}${extra}`);
    } else {
      console.log(`${prefix} ${message}${extra}`);
    }
  }
}

function log(level: LogLevel, message: string, context?: Record<string, unknown>) {
  emit({
    level,
    message,
    timestamp: new Date().toISOString(),
    ...context,
  });
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => log("debug", message, context),
  info: (message: string, context?: Record<string, unknown>) => log("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => log("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => log("error", message, context),

  /** Log an API request with standard fields */
  request: (method: string, path: string, userId?: string, context?: Record<string, unknown>) => {
    log("info", `${method} ${path}`, {
      type: "api_request",
      method,
      route: path,
      userId,
      ...context,
    });
  },

  /** Log an API response with latency */
  response: (method: string, path: string, statusCode: number, durationMs: number, context?: Record<string, unknown>) => {
    const level: LogLevel = statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "info";
    log(level, `${method} ${path} ${statusCode} ${durationMs}ms`, {
      type: "api_response",
      method,
      route: path,
      statusCode,
      durationMs,
      ...context,
    });
  },

  /** Log a security-relevant event */
  security: (event: string, context?: Record<string, unknown>) => {
    log("warn", `SECURITY: ${event}`, { type: "security", securityEvent: true, ...context });
  },

  /** Log a database query timing */
  db: (operation: string, durationMs: number, context?: Record<string, unknown>) => {
    const level: LogLevel = durationMs > 1000 ? "warn" : "debug";
    log(level, `DB: ${operation} ${durationMs}ms`, {
      type: "db_query",
      operation,
      durationMs,
      ...context,
    });
  },

  /** Log an integration/connector event */
  integration: (source: string, event: string, context?: Record<string, unknown>) => {
    log("info", `Integration[${source}]: ${event}`, {
      type: "integration",
      source,
      ...context,
    });
  },

  /** Log a job queue event */
  job: (jobType: string, event: string, context?: Record<string, unknown>) => {
    log("info", `Job[${jobType}]: ${event}`, {
      type: "job",
      jobType,
      ...context,
    });
  },

  /** Log an audit-relevant event */
  audit: (action: string, entityType: string, entityId: string, userId: string, context?: Record<string, unknown>) => {
    log("info", `Audit: ${action} ${entityType}/${entityId}`, {
      type: "audit",
      action,
      entityType,
      entityId,
      userId,
      ...context,
    });
  },
};
