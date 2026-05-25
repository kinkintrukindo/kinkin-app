// Run once to create the admin Supabase user.
// Requires SUPABASE_SERVICE_KEY in .env.local
// Usage: node scripts/setup-auth.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env.local manually
const envPath = resolve(process.cwd(), ".env.local");
const envContents = readFileSync(envPath, "utf-8");
const env = Object.fromEntries(
  envContents.split("\n").filter(Boolean).map((line) => {
    const [k, ...v] = line.split("=");
    return [k.trim(), v.join("=").trim()];
  })
);

const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ADMIN_EMAIL = "info@kinkintrukindo.com";
const ADMIN_PASSWORD = "808880";
const ADMIN_USERNAME = "admin";

// Check if admin already exists
const { data: existing } = await supabase
  .from("user_profiles")
  .select("id")
  .eq("username", ADMIN_USERNAME)
  .single();

if (existing) {
  console.log("Admin user already exists. Nothing to do.");
  process.exit(0);
}

// Create auth user
const { data: authData, error: createErr } = await supabase.auth.admin.createUser({
  email: ADMIN_EMAIL,
  password: ADMIN_PASSWORD,
  email_confirm: true,
});

if (createErr) {
  console.error("Error creating auth user:", createErr.message);
  process.exit(1);
}

// Create profile
const { error: profileErr } = await supabase.from("user_profiles").insert({
  user_id: authData.user.id,
  username: ADMIN_USERNAME,
  email: ADMIN_EMAIL,
  role: "admin",
  approved: true,
});

if (profileErr) {
  console.error("Error creating profile:", profileErr.message);
  process.exit(1);
}

console.log("Admin user created successfully!");
console.log(`   Username: ${ADMIN_USERNAME}`);
console.log(`   Email:    ${ADMIN_EMAIL}`);
console.log(`   Password: ${ADMIN_PASSWORD}`);
