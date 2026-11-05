import { DEMO, SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
const today = () => new Date().toISOString().slice(0, 10);

// ---------------- demo backend (localStorage, fake data) ----------------
function demoBackend() {
  // Device mode: real entries, empty to start, saved only in this browser on this device.
  // Add ?demo=1 to the address to see the fake sample data instead.
  const fake = new URLSearchParams(location.search).get("demo") === "1";
  const KEY = fake ? "agency-crm-demo-v1" : "agency-crm-local-v1";
  const as = new URLSearchParams(location.search).get("as") === "member" ? "member" : "owner";
  const me = as === "owner" ? { id: "u-donovan", name: "Owner Demo", role: "owner" } : { id: "u-ryan", name: "Member Demo", role: "member" };
  const team = [{ user_id: "u-donovan", name: "Owner Demo" }, { user_id: "u-ryan", name: "Member Demo" }, { user_id: "u-alex", name: "Member Demo 2" }];
  const mk = new Date().toISOString().slice(0, 7);
  const seed = {
    customers: [
      { id: uid(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: "u-donovan", updated_by: "u-donovan", business_name: "Sample Roofing Co", contact_name: "Pat Sample", phone: "(734) 555-0101", email: "pat@example.com", address: "100 Main St, Canton, MI 48187", status: "active", plan: "Grow", setup_fee: 1000, setup_paid: true, monthly_amount: 297, billing_day: 5, start_date: today(), paid_month: mk, next_followup: null, notes: "Demo record.", legal_name: "Sample Roofing LLC", entity_type: "LLC", agreement_date: today() },
      { id: uid(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: "u-ryan", updated_by: "u-ryan", business_name: "Demo Landscaping", contact_name: "Sam Demo", phone: "(734) 555-0102", email: "sam@example.com", status: "active", plan: "Launch", setup_fee: 500, setup_paid: true, monthly_amount: 99, billing_day: 12, start_date: today(), paid_month: "2000-01", next_followup: today(), notes: "Unpaid this month, for testing." },
      { id: uid(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: "u-alex", updated_by: "u-alex", business_name: "Test Cleaning Service", contact_name: "Jo Test", phone: "(734) 555-0103", status: "lead", plan: "Launch", notes: "Wants to see the site first." },
    ],
    expenses: [
      { id: uid(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: "u-donovan", spent_on: today(), amount: 20, category: "Software", business: "clear_sites", paid_by: "Donovan", notes: "Domain" },
      { id: uid(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: "u-ryan", spent_on: today(), amount: 35.5, category: "Supplies", business: "all_seasons", paid_by: "Ryan", notes: "Gloves and bags" },
    ],
  };
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
  const save = (d) => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {} };
  let db = load() || (fake ? seed : { customers: [], expenses: [] }); save(db);
  const files = {};
  const toDataUrl = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  return {
    demo: true,
    fake,
    async session() { return me; },
    async login() { return me; }, async logout() { location.reload(); },
    async team() { return team; },
    async list(t) { return JSON.parse(JSON.stringify(db[t])); },
    async save(t, row) {
      const now = new Date().toISOString();
      if (row.id) { const i = db[t].findIndex((r) => r.id === row.id); db[t][i] = { ...db[t][i], ...row, updated_at: now, updated_by: me.id }; }
      else db[t].unshift({ ...row, id: uid(), created_at: now, updated_at: now, created_by: me.id, updated_by: me.id });
      save(db);
    },
    async remove(t, id) { if (me.role !== "owner") throw new Error("Only the owner can delete."); db[t] = db[t].filter((r) => r.id !== id); save(db); },
    async upload(file) {
      if (fake) { const p = "demo/" + uid() + "-" + file.name; files[p] = URL.createObjectURL(file); return p; }
      if (file.size > 400 * 1024) throw new Error("That file is too big for device mode (400 KB max). Shrink the photo, or wait for the shared version.");
      return await toDataUrl(file);
    },
    async fileUrl(p) { return p && p.startsWith("data:") ? p : files[p] || null; },
  };
}

// ---------------- Supabase backend ----------------
async function supabaseBackend() {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  let cached = null;
  const throwIf = ({ error }) => { if (error) throw new Error(error.message); };
  return {
    demo: false,
    async session() {
      const { data } = await sb.auth.getSession();
      if (!data.session) return null;
      if (cached) return cached;
      const { data: row } = await sb.from("team").select("name,role").eq("user_id", data.session.user.id).maybeSingle();
      if (!row) return { id: data.session.user.id, name: data.session.user.email, role: "none" };
      return (cached = { id: data.session.user.id, name: row.name, role: row.role });
    },
    async login(email, password) { const r = await sb.auth.signInWithPassword({ email, password }); throwIf(r); cached = null; return this.session(); },
    async logout() { await sb.auth.signOut(); location.reload(); },
    async team() { const r = await sb.from("team").select("user_id,name"); throwIf(r); return r.data; },
    async list(t) { const r = await sb.from(t).select("*").order("created_at", { ascending: false }); throwIf(r); return r.data; },
    async save(t, row) {
      const me = await this.session(); const now = new Date().toISOString();
      if (row.id) { const { id, ...rest } = row; const r = await sb.from(t).update({ ...rest, updated_at: now, updated_by: me.id }).eq("id", id); throwIf(r); }
      else { const r = await sb.from(t).insert({ ...row, created_by: me.id, updated_by: me.id }); throwIf(r); }
    },
    async remove(t, id) { const r = await sb.from(t).delete().eq("id", id); throwIf(r); },
    async upload(file) {
      const p = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const r = await sb.storage.from("files").upload(p, file); throwIf(r); return p;
    },
    async fileUrl(p) { const r = await sb.storage.from("files").createSignedUrl(p, 600); return r.data ? r.data.signedUrl : null; },
  };
}

export const getBackend = () => (DEMO ? Promise.resolve(demoBackend()) : supabaseBackend());
