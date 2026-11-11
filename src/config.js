// Paste your Supabase project values here (Project Settings > API).
// The publishable (anon) key is designed to be public. Never paste a secret / service_role key here.
// While these are empty the app runs in DEMO mode with fake data stored only in this browser.
export const SUPABASE_URL = "https://awraldlewltlhimhemdr.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_3u36z_zbt8vrB73744su9g_4ul-g3Dw"; // public "publishable" key, safe in a browser because every table has row-level security
export const DEMO = !SUPABASE_URL || !SUPABASE_ANON_KEY;
