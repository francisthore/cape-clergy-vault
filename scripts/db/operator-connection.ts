// Interactive maintenance scripts only. Never import this boundary from services.
import { connectLocalDatabase } from "../../database/connection.server.ts";
import { connectProductionDatabase } from "../../database/production.server.ts";

export function connectOperator() {
  const mode = process.env["CAPE_DATABASE_MODE"] ?? "local";
  if (mode === "local") return connectLocalDatabase();
  if (mode === "production") return connectProductionDatabase("operator");
  throw Error("Unknown maintenance target");
}
