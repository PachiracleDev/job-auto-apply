import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { profiles, jobPreferences } from "../db/schema.js";

const profileBody = z.object({
  fullName: z.string().min(1),
  professionalTitle: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1),
  location: z.string().min(1),
  education: z.array(
    z.object({
      institution: z.string(),
      title: z.string(),
      type: z.string(),
      year: z.string().optional(),
    }),
  ),
  languages: z.array(
    z.object({
      language: z.string(),
      level: z.string(),
    }),
  ),
});

const jobPrefsBody = z.object({
  salaryExpectation: z.string().optional(),
  salaryCurrency: z.string().length(3).default("USD"),
  roles: z.array(z.string()).min(1),
  modality: z.array(z.string()).default([]),
  employmentType: z.array(z.string()).default([]),
});

export const userDataRoutes = new Hono();

userDataRoutes.put("/v1/users/:userId/profile", async (c) => {
  const userId = Number.parseInt(c.req.param("userId"), 10);
  if (Number.isNaN(userId)) {
    return c.json({ error: "userId inválido" }, 400);
  }
  let body: z.infer<typeof profileBody>;
  try {
    body = profileBody.parse(await c.req.json());
  } catch {
    return c.json({ error: "Body inválido" }, 400);
  }

  const now = new Date();
  await getDb()
    .insert(profiles)
    .values({
      userId,
      fullName: body.fullName,
      professionalTitle: body.professionalTitle,
      email: body.email,
      phone: body.phone,
      location: body.location,
      education: body.education,
      languages: body.languages,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: profiles.userId,
      set: {
        fullName: body.fullName,
        professionalTitle: body.professionalTitle,
        email: body.email,
        phone: body.phone,
        location: body.location,
        education: body.education,
        languages: body.languages,
        updatedAt: now,
      },
    });

  return c.json({ ok: true });
});

userDataRoutes.put("/v1/users/:userId/job-preferences", async (c) => {
  const userId = Number.parseInt(c.req.param("userId"), 10);
  if (Number.isNaN(userId)) {
    return c.json({ error: "userId inválido" }, 400);
  }
  let body: z.infer<typeof jobPrefsBody>;
  try {
    body = jobPrefsBody.parse(await c.req.json());
  } catch {
    return c.json({ error: "Body inválido" }, 400);
  }

  const now = new Date();
  await getDb()
    .insert(jobPreferences)
    .values({
      userId,
      salaryExpectation: body.salaryExpectation ?? null,
      salaryCurrency: body.salaryCurrency,
      roles: body.roles,
      modality: body.modality,
      employmentType: body.employmentType,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: jobPreferences.userId,
      set: {
        salaryExpectation: body.salaryExpectation ?? null,
        salaryCurrency: body.salaryCurrency,
        roles: body.roles,
        modality: body.modality,
        employmentType: body.employmentType,
        updatedAt: now,
      },
    });

  return c.json({ ok: true });
});
