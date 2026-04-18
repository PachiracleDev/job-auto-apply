import "./env.js";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { apiKeyAuth } from "./middleware/apiKey.js";
import { healthRoutes } from "./routes/health.js";
import { userDataRoutes } from "./routes/userData.js";
import { providerRoutes } from "./routes/providers.js";
import { jobsRoutes } from "./routes/jobs.js";

const app = new Hono();

app.route("/", healthRoutes);

const secured = new Hono();
secured.use("*", apiKeyAuth);
secured.route("/", userDataRoutes);
secured.route("/", providerRoutes);
secured.route("/", jobsRoutes);
app.route("/", secured);

const port = Number.parseInt(process.env["PORT"] ?? "8787", 10);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[worker] listening on http://127.0.0.1:${String(info.port ?? port)}`);
});
