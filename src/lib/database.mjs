import { createPool } from "mysql2/promise";

const databaseKeys = ["DATABASE_HOST","DATABASE_USER","DATABASE_PASSWORD","DATABASE_NAME"];
let pool;

export function databaseConfigured() {
  return databaseKeys.some(key => Boolean(process.env[key]));
}

export function databasePool() {
  if (pool) return pool;
  const missing = databaseKeys.filter(key => !process.env[key]);
  if (missing.length) throw new Error("Missing database settings: " + missing.join(", "));
  const port = Number(process.env.DATABASE_PORT || 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid database port");
  pool = createPool({
    host: process.env.DATABASE_HOST,
    port,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    charset: "utf8mb4",
    connectionLimit: 4,
    queueLimit: 16,
    connectTimeout: 5000,
    ...(process.env.DATABASE_SSL === "true" ? {ssl:{rejectUnauthorized:true,verifyIdentity:true}} : {}),
  });
  return pool;
}
