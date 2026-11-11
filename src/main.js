import { getBackend } from "./config-bridge.js";
import Sortable from "sortablejs";

const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: Number.isInteger(Number(n) || 0) ? 0 : 2 });
const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);
const todayStr = () => new Date().toISOString().slice(0, 10);

const PLANS = ["Launch", "Grow", "Scale", "Other"];
const STATUSES = ["lead", "active", "paused", "cancelled"];
const CATS = ["Software", "Ads", "Hosting and domains", "Supplies", "Equipment", "Fees", "Other"];
const BIZ = { clear_sites: "Clear Sites", all_seasons: "All Seasons", shared: "Shared" };
const PAYERS = ["Donovan", "Ryan", "Alex", "Business card"];

// Deal pipeline: the stages a customer moves through, left to right.
const STAGES = [["ready_to_quote", "Ready to quote"], ["quoted", "Quoted"], ["accepted", "Accepted"], ["in_progress", "In progress"], ["completed", "Completed"], ["paid", "Paid"], ["lost", "Lost"]];
const stageOf = (c) => c.stage || (c.status === "active" ? "in_progress" : "ready_to_quote");
const stageLabel = (k) => (STAGES.find((s) => s[0] === k) || [k, k])[1];

const S = { be: null, me: null, team: {}, tab: "pipeline", customers: [], expenses: [], filter: "all", q: "", month: monthKey(), msg: "" };
const app = $("#app");

function paidThisMonth(c) { return c.paid_month === monthKey(); }
function nameOf(id) { return S.team[id] || "someone"; }

// ---------- shell ----------
function shell(inner) {
  return `<header class="top"><div class="wrap bar"><div class="brand">Clear Sites <span>CRM</span></div>
  <nav aria-label="Main"><button class="tab${S.tab === "pipeline" ? " on" : ""}" data-tab="pipeline">Pipeline</button><button class="tab${S.tab === "customers" ? " on" : ""}" data-tab="customers">Customers</button><button class="tab${S.tab === "expenses" ? " on" : ""}" data-tab="expenses">Expenses</button></nav>
  <div class="who"><span>${esc(S.me.name)}</span><button class="link" id="out">Sign out</button></div></div></header>
  ${S.be.demo ? `<div class="demo">${S.be.fake ? "Demo mode: fake sample data. Remove ?demo=1 from the address for your real entries." : "Saved only in this browser on this device. Use Export CSV often to keep a backup. Not shared with Ryan or Alex yet."}</div>` : ""}
  <main class="wrap${S.tab === "pipeline" ? " wide" : ""}">${S.msg ? `<p class="flash" role="status">${esc(S.msg)}</p>` : ""}${inner}</main>`;
}

// ---------- pipeline ----------
function pipelineView() {
  const by = (k) => S.customers.filter((c) => stageOf(c) === k);
  const val = (arr) => arr.reduce((a, c) => a + (Number(c.quote_amount) || 0), 0);
  const open = ["ready_to_quote", "quoted", "accepted", "in_progress", "completed"].flatMap(by);
  const paidMonth = by("paid").filter((c) => (c.paid_on || "").slice(0, 7) === monthKey());
  return `<div class="sum"><div><b>${open.length}</b><span>Open deals</span></div><div><b>${money(val(open))}</b><span>Open value</span></div><div><b>${money(val(by("quoted")))}</b><span>Waiting on a yes</span></div><div><b>${money(val(paidMonth))}</b><span>Paid this month</span></div></div>
  <div class="tools"><span class="mut">Drag a card to a new stage, or tap it to edit.</span><button class="btn" id="new">Add lead</button></div>
  <div class="lanes">${STAGES.map(([k, label]) => { const items = by(k); return `<section class="lane-col"><h3>${label} <span class="cnt">${items.length}</span></h3><div class="lane-val">${val(items) ? money(val(items)) : "&nbsp;"}</div>
    <ul class="lane" data-stage="${k}">${items.map((c) => `<li data-id="${c.id}"><button class="card" data-open="${c.id}"><b>${esc(c.business_name)}</b><span class="mut">${esc(c.contact_name || c.phone || "")}</span>${c.quote_amount ? `<span class="amt">${money(c.quote_amount)}</span>` : ""}${c.source ? `<span class="tag">${esc(c.source)}</span>` : ""}</button></li>`).join("")}</ul></section>`; }).join("")}</div>`;
}
function initPipeline() {
  document.querySelectorAll(".lane").forEach((el) => {
    Sortable.create(el, {
      group: "pipeline", forceFallback: true, fallbackTolerance: 3, animation: 160, ghostClass: "ghost", chosenClass: "chosen", delay: 140, delayOnTouchOnly: true, touchStartThreshold: 6,
      onEnd: async (evt) => {
        const id = evt.item.dataset.id, to = evt.to.dataset.stage;
        const c = S.customers.find((x) => x.id === id);
        if (!c || stageOf(c) === to) return;
        const patch = { id, stage: to };
        if (to === "quoted" && !c.quoted_on) patch.quoted_on = todayStr();
        if (to === "paid" && !c.paid_on) patch.paid_on = todayStr();
        try { await S.be.save("customers", patch); await refresh(); S.msg = `Moved to ${stageLabel(to)}.`; render(); } catch (x) { alert(x.message || "Could not move that card."); await refresh(); render(); }
      },
    });
  });
}

// ---------- customers ----------
function customerSummary() {
  const act = S.customers.filter((c) => c.status === "active");
  const mrr = act.reduce((a, c) => a + (Number(c.monthly_amount) || 0), 0);
  const unpaid = act.filter((c) => Number(c.monthly_amount) > 0 && !paidThisMonth(c));
  const due = S.customers.filter((c) => c.next_followup && c.next_followup <= todayStr() && c.status !== "cancelled");
  return `<div class="sum"><div><b>${money(mrr)}</b><span>Monthly recurring</span></div><div><b>${act.length}</b><span>Active</span></div><div><b>${unpaid.length}</b><span>Unpaid this month</span></div><div><b>${due.length}</b><span>Follow-ups due</span></div></div>`;
}
function visibleCustomers() {
  const q = S.q.trim().toLowerCase();
  return S.customers.filter((c) => {
    if (S.filter === "unpaid" && !(c.status === "active" && Number(c.monthly_amount) > 0 && !paidThisMonth(c))) return false;
    if (["lead", "active", "paused", "cancelled"].includes(S.filter) && c.status !== S.filter) return false;
    if (S.filter === "due" && !(c.next_followup && c.next_followup <= todayStr() && c.status !== "cancelled")) return false;
    if (q && ![c.business_name, c.contact_name, c.phone, c.email, c.address].some((v) => String(v || "").toLowerCase().includes(q))) return false;
    return true;
  });
}
function customersView() {
  const rows = visibleCustomers();
  const f = (k, l) => `<button class="chip${S.filter === k ? " on" : ""}" data-filter="${k}">${l}</button>`;
  return `${customerSummary()}
  <div class="tools"><input id="q" type="search" placeholder="Search name, phone, email, address" value="${esc(S.q)}" aria-label="Search customers"><button class="btn" id="new">Add customer</button></div>
  <div class="chips">${f("all", "All")}${f("lead", "Leads")}${f("active", "Active")}${f("unpaid", "Unpaid")}${f("due", "Follow-up due")}${f("paused", "Paused")}${f("cancelled", "Cancelled")}</div>
  <ul class="rows">${rows.map((c) => `<li><button class="row" data-open="${c.id}"><span class="r1"><b>${esc(c.business_name)}</b><span class="mut">${esc(c.contact_name || "")}${c.phone ? " · " + esc(c.phone) : ""}</span></span>
  <span class="r2"><span>${esc(c.plan || "")} ${Number(c.monthly_amount) ? money(c.monthly_amount) + "/mo" : ""}</span><span class="mut">${esc(stageLabel(stageOf(c)))} · ${esc(c.status)}${c.status === "active" && Number(c.monthly_amount) ? (paidThisMonth(c) ? " · paid" : " · unpaid") : ""}${c.next_followup ? " · follow up " + esc(c.next_followup) : ""}</span></span></button></li>`).join("") || `<li class="empty">No customers match.</li>`}</ul>
  <p class="foot"><button class="link" id="csv">Export CSV</button></p>`;
}

const field = (name, label, v = "", opts = {}) => {
  const { type = "text", full = false, list = null, rows = 3, ph = "" } = opts;
  const cls = full ? ' class="full"' : "";
  if (list) return `<label${cls}>${label}<select name="${name}">${list.map(([val, text]) => `<option value="${esc(val)}"${String(v) === String(val) ? " selected" : ""}>${esc(text)}</option>`).join("")}</select></label>`;
  if (type === "textarea") return `<label${cls}>${label}<textarea name="${name}" rows="${rows}">${esc(v)}</textarea></label>`;
  if (type === "check") return `<label${cls} class="chk${full ? " full" : ""}"><input type="checkbox" name="${name}" ${v ? "checked" : ""}> ${label}</label>`;
  return `<label${cls}>${label}<input name="${name}" type="${type}" value="${esc(v)}" placeholder="${esc(ph)}"${type === "number" ? ' step="any" inputmode="decimal"' : ""}></label>`;
};

function customerForm(c = {}) {
  const isNew = !c.id;
  return `<form id="f" data-t="customers" data-id="${esc(c.id || "")}"><h2>${isNew ? "New lead" : esc(c.business_name)}</h2>
  <fieldset><legend>Deal</legend>
  ${field("stage", "Stage", isNew ? "ready_to_quote" : stageOf(c), { list: STAGES })}${field("quote_amount", "Quote amount ($)", c.quote_amount ?? "", { type: "number" })}
  ${field("source", "Where it came from", c.source || "", { ph: "Website form, call, referral" })}${field("paid_on", "Paid on", c.paid_on || "", { type: "date" })}
  ${field("lead_details", "What they asked for", c.lead_details, { type: "textarea", full: true, rows: 3 })}</fieldset>
  <fieldset><legend>Contact</legend>
  ${field("business_name", "Business name*", c.business_name, { full: true })}${field("contact_name", "Contact name", c.contact_name)}${field("phone", "Phone", c.phone, { type: "tel" })}
  ${field("email", "Email", c.email, { type: "email" })}${field("status", "Status", c.status || "lead", { list: STATUSES.map((s) => [s, s[0].toUpperCase() + s.slice(1)]) })}${field("address", "Address", c.address, { full: true })}</fieldset>
  <fieldset><legend>Plan and billing</legend>
  ${field("plan", "Plan", c.plan || "Launch", { list: PLANS.map((p) => [p, p]) })}${field("monthly_amount", "Monthly amount ($)", c.monthly_amount ?? "", { type: "number" })}
  ${field("setup_fee", "Setup fee ($)", c.setup_fee ?? "", { type: "number" })}${field("billing_day", "Billing day of month", c.billing_day ?? "", { type: "number", ph: "1 to 31" })}
  ${field("start_date", "Start date", c.start_date || "", { type: "date" })}${field("next_followup", "Next follow-up", c.next_followup || "", { type: "date" })}
  ${field("setup_paid", "Setup fee paid", c.setup_paid, { type: "check" })}
  <label class="chk"><input type="checkbox" name="paid_now" ${paidThisMonth(c) ? "checked" : ""}> Paid for ${monthKey()}</label></fieldset>
  <fieldset><legend>Legal on file</legend>
  ${field("legal_name", "Business legal name", c.legal_name)}${field("entity_type", "Entity type", c.entity_type, { ph: "LLC, sole prop, corp" })}${field("ein", "EIN (optional)", c.ein)}${field("agreement_date", "Agreement signed", c.agreement_date || "", { type: "date" })}
  <label class="full">Agreement file (PDF or photo)<input type="file" name="agreement_file" accept="application/pdf,image/*">${c.agreement_path ? `<a href="#" class="link" data-file="${esc(c.agreement_path)}">Open current file</a>` : ""}</label>
  ${field("domain_notes", "Domain and hosting notes", c.domain_notes, { type: "textarea", full: true, rows: 2 })}
  <p class="note full">Do not store card numbers, Social Security numbers or passwords here.</p></fieldset>
  <fieldset><legend>Notes</legend>${field("notes", "Notes", c.notes, { type: "textarea", full: true, rows: 4 })}</fieldset>
  ${c.id ? `<p class="note">Added by ${esc(nameOf(c.created_by))}. Last updated by ${esc(nameOf(c.updated_by))} ${esc((c.updated_at || "").slice(0, 10))}.</p>` : ""}
  <div class="acts"><button class="btn" type="submit">Save</button><button class="link" type="button" data-close>Cancel</button>${c.id && S.me.role === "owner" ? `<button class="link danger" type="button" data-del>Delete</button>` : ""}</div></form>`;
}

// ---------- expenses ----------
// A monthly expense counts in every month from its start month until its "stops after" month (if set).
const isMonthly = (e) => e.frequency === "monthly";
function appliesIn(e, month) {
  const start = (e.spent_on || "").slice(0, 7);
  if (!isMonthly(e)) return start === month;
  return start <= month && (!e.ends_on || e.ends_on.slice(0, 7) >= month);
}
function expensesView() {
  const inMonth = S.expenses.filter((e) => appliesIn(e, S.month));
  const sum = (arr) => arr.reduce((a, e) => a + Number(e.amount || 0), 0);
  const total = sum(inMonth), monthly = sum(inMonth.filter(isMonthly)), once = total - monthly;
  const by = (k, f) => sum(inMonth.filter((e) => e[k] === f));
  const cats = {}; inMonth.forEach((e) => (cats[e.category || "Other"] = (cats[e.category || "Other"] || 0) + Number(e.amount || 0)));
  return `<div class="sum"><div><b>${money(total)}</b><span>Total this month</span></div><div><b>${money(monthly)}</b><span>Monthly (recurring)</span></div><div><b>${money(once)}</b><span>One-time</span></div><div><b>${money(by("business", "clear_sites"))} / ${money(by("business", "all_seasons"))}</b><span>Clear Sites / All Seasons</span></div></div>
  <div class="tools"><label class="mon">Month <input id="mon" type="month" value="${esc(S.month)}"></label><button class="btn" id="newx">Add expense</button></div>
  ${Object.keys(cats).length ? `<p class="cats">${Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k)} <b>${money(v)}</b>`).join(" &nbsp;·&nbsp; ")}</p>` : ""}
  <ul class="rows">${inMonth.map((e) => `<li><button class="row" data-openx="${e.id}"><span class="r1"><b>${money(e.amount)}</b><span class="mut">${esc(e.notes || e.category || "")}</span></span><span class="r2"><span>${esc(e.category || "")}</span><span class="mut">${isMonthly(e) ? "monthly since " : ""}${esc(e.spent_on)}${isMonthly(e) && e.ends_on ? " until " + esc(e.ends_on) : ""} · ${esc(BIZ[e.business] || e.business)}${e.paid_by ? " · " + esc(e.paid_by) : ""}${e.receipt_path ? " · receipt" : ""}</span></span></button></li>`).join("") || `<li class="empty">No expenses this month.</li>`}</ul>
  <p class="foot"><button class="link" id="csv">Export CSV (all months)</button> &nbsp;·&nbsp; <label class="link" style="display:inline;cursor:pointer">Import CSV<input id="imp" type="file" accept=".csv,text/csv" hidden></label>
  <span class="note" style="display:block;margin-top:6px">Import columns: date, amount, category, business (Clear Sites, All Seasons or Shared), paid_by, notes, type (monthly or leave blank for one-time).</span></p>`;
}

// minimal CSV reader (handles quoted cells)
function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
async function importExpenses(file) {
  const rows = parseCsv(await file.text());
  if (rows.length < 2) throw new Error("That file has no rows.");
  const head = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const col = (...names) => head.findIndex((h) => names.includes(h));
  const iD = col("date", "spent_on"), iA = col("amount", "total"), iC = col("category"), iB = col("business"), iP = col("paid_by", "paid"), iN = col("notes", "note", "description"), iF = col("type", "frequency", "recurring");
  if (iA < 0) throw new Error("The file needs an amount column.");
  const bizKey = (v) => { v = String(v || "").toLowerCase(); return v.includes("season") ? "all_seasons" : v.includes("clear") || v.includes("site") ? "clear_sites" : "shared"; };
  let n = 0;
  for (const r of rows.slice(1)) {
    const amt = Number(String(r[iA]).replace(/[$,\s]/g, ""));
    if (!amt || Number.isNaN(amt)) continue;
    const d = iD >= 0 ? new Date(r[iD]) : new Date();
    await S.be.save("expenses", { frequency: iF >= 0 && /month|recurr|yes|true/i.test(r[iF] || "") ? "monthly" : "once", ends_on: null, spent_on: (isNaN(d) ? new Date() : d).toISOString().slice(0, 10), amount: amt, category: iC >= 0 && r[iC] ? r[iC].trim() : "Other", business: bizKey(iB >= 0 ? r[iB] : ""), paid_by: iP >= 0 && r[iP] ? r[iP].trim() : "Business card", notes: iN >= 0 ? r[iN].trim() || null : null, receipt_path: null });
    n++;
  }
  return n;
}
function expenseForm(e = {}) {
  const isNew = !e.id;
  return `<form id="f" data-t="expenses" data-id="${esc(e.id || "")}"><h2>${isNew ? "New expense" : "Expense"}</h2><fieldset>
  ${field("frequency", "Type", e.frequency || "once", { list: [["once", "One-time"], ["monthly", "Monthly (repeats every month)"]], full: true })}
  ${field("spent_on", "Date* (first charge, for monthly)", e.spent_on || todayStr(), { type: "date" })}${field("amount", "Amount ($)* (each month, for monthly)", e.amount ?? "", { type: "number" })}
  ${field("ends_on", "Monthly only: stops after (leave blank if ongoing)", e.ends_on || "", { type: "date", full: true })}
  ${field("category", "Category", e.category || "Software", { list: CATS.map((c) => [c, c]) })}${field("business", "Which business", e.business || "shared", { list: Object.entries(BIZ) })}
  ${field("paid_by", "Paid by", e.paid_by || "Donovan", { list: PAYERS.map((c) => [c, c]) })}
  <label class="full">Receipt photo<input type="file" name="receipt_file" accept="image/*,application/pdf" capture="environment">${e.receipt_path ? `<a href="#" class="link" data-file="${esc(e.receipt_path)}">Open current receipt</a>` : ""}</label>
  ${field("notes", "Notes", e.notes, { type: "textarea", full: true, rows: 2 })}</fieldset>
  ${e.id ? `<p class="note">Added by ${esc(nameOf(e.created_by))}.</p>` : ""}
  <div class="acts"><button class="btn" type="submit">Save</button><button class="link" type="button" data-close>Cancel</button>${e.id && S.me.role === "owner" ? `<button class="link danger" type="button" data-del>Delete</button>` : ""}</div></form>`;
}

// ---------- login ----------
function loginView(err = "") {
  app.innerHTML = `<div class="login"><h1>Clear Sites <span>CRM</span></h1><p class="mut">Private. Team only.</p>
  <form id="lf"><label>Email<input name="email" type="email" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label>
  <button class="btn" type="submit">Sign in</button>${err ? `<p class="err" role="alert">${esc(err)}</p>` : ""}${S.be.resetEmail ? `<p class="note"><a href="#" id="fp">Forgot password?</a></p>` : ""}</form></div>`;
  const fp = $("#fp"); if (fp) fp.onclick = async (e) => { e.preventDefault(); const em = $("#lf").elements.email.value.trim(); if (!em) return loginView("Type your email first, then tap Forgot password."); try { await S.be.resetEmail(em); loginView("If that email is on the team, a link to set a new password is on its way."); } catch (x) { loginView("Could not send the email right now. Try again in a minute."); } };
  $("#lf").addEventListener("submit", async (e) => {
    e.preventDefault(); const d = new FormData(e.target);
    try { S.me = await S.be.login(d.get("email"), d.get("password")); await boot(true); } catch (x) { loginView("Sign in failed. Check your email and password."); }
  });
}

// ---------- csv ----------
function toCsv(rows) {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const cell = (v) => { v = v == null ? "" : String(v); if (/^[=+\-@]/.test(v)) v = "'" + v; return `"${v.replace(/"/g, '""')}"`; };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
}
function download(name, text) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" })); a.download = name; a.click(); }

// ---------- render ----------
function render() {
  const view = S.tab === "pipeline" ? pipelineView() : S.tab === "customers" ? customersView() : expensesView();
  app.innerHTML = shell(view) + `<dialog id="dlg"></dialog>`;
  S.msg = "";
  if (S.tab === "pipeline") initPipeline();
}
function openForm(html) { const d = $("#dlg"); d.innerHTML = html; d.showModal(); }

async function refresh() { [S.customers, S.expenses] = await Promise.all([S.be.list("customers"), S.be.list("expenses")]); }

app.addEventListener("click", async (e) => {
  const t = e.target.closest("button, a");
  if (!t) return;
  if (t.dataset.tab) { S.tab = t.dataset.tab; return render(); }
  if (t.id === "out") return S.be.logout();
  if (t.dataset.filter) { S.filter = t.dataset.filter; return render(); }
  if (t.id === "new") return openForm(customerForm());
  if (t.id === "newx") return openForm(expenseForm());
  if (t.dataset.open) return openForm(customerForm(S.customers.find((c) => c.id === t.dataset.open)));
  if (t.dataset.openx) return openForm(expenseForm(S.expenses.find((c) => c.id === t.dataset.openx)));
  if ("close" in t.dataset) return $("#dlg").close();
  if (t.id === "csv") return download(S.tab === "customers" ? "customers.csv" : "expenses.csv", toCsv(S.tab === "customers" ? S.customers : S.expenses));
  if (t.dataset.file) { e.preventDefault(); const u = await S.be.fileUrl(t.dataset.file); if (u) window.open(u, "_blank", "noopener"); else alert("Could not open that file."); return; }
  if ("del" in t.dataset) {
    const f = $("#f"); if (!confirm("Delete this record permanently?")) return;
    try { await S.be.remove(f.dataset.t, f.dataset.id); $("#dlg").close(); await refresh(); S.msg = "Deleted."; render(); } catch (x) { alert(x.message); }
  }
});
app.addEventListener("change", async (e) => {
  if (e.target.id !== "imp" || !e.target.files[0]) return;
  try { const n = await importExpenses(e.target.files[0]); await refresh(); S.msg = `Imported ${n} expense${n === 1 ? "" : "s"}.`; render(); } catch (x) { alert(x.message || "Could not import that file."); }
});
app.addEventListener("input", (e) => {
  if (e.target.id === "q") { S.q = e.target.value; const pos = e.target.selectionStart; render(); const q = $("#q"); q.focus(); q.setSelectionRange(pos, pos); }
  if (e.target.id === "mon") { S.month = e.target.value || monthKey(); render(); }
});
app.addEventListener("submit", async (e) => {
  if (e.target.id !== "f") return;
  e.preventDefault();
  const f = e.target, d = new FormData(f), t = f.dataset.t, id = f.dataset.id;
  const num = (k) => (d.get(k) === "" || d.get(k) == null ? null : Number(d.get(k)));
  const str = (k) => (d.get(k) === "" ? null : d.get(k));
  const btn = f.querySelector('button[type="submit"]'); btn.disabled = true;
  try {
    let row;
    if (t === "customers") {
      const existing = id ? S.customers.find((c) => c.id === id) : {};
      if (!String(d.get("business_name")).trim()) throw new Error("Business name is required.");
      const stage = d.get("stage") || "ready_to_quote";
      row = { stage, quote_amount: num("quote_amount"), source: str("source"), lead_details: str("lead_details"),
        quoted_on: existing.quoted_on || (stage === "quoted" ? todayStr() : null), paid_on: str("paid_on") || (stage === "paid" ? todayStr() : null),
        business_name: d.get("business_name").trim(), contact_name: str("contact_name"), phone: str("phone"), email: str("email"), address: str("address"), status: d.get("status"), plan: d.get("plan"),
        setup_fee: num("setup_fee") ?? 0, setup_paid: d.get("setup_paid") === "on", monthly_amount: num("monthly_amount") ?? 0, billing_day: num("billing_day"), start_date: str("start_date"), next_followup: str("next_followup"),
        notes: str("notes"), legal_name: str("legal_name"), entity_type: str("entity_type"), ein: str("ein"), agreement_date: str("agreement_date"), domain_notes: str("domain_notes"),
        paid_month: d.get("paid_now") === "on" ? monthKey() : (existing.paid_month === monthKey() ? null : existing.paid_month || null), agreement_path: existing.agreement_path || null };
      const file = d.get("agreement_file"); if (file && file.size) row.agreement_path = await S.be.upload(file);
    } else {
      const existing = id ? S.expenses.find((c) => c.id === id) : {};
      if (num("amount") == null || Number.isNaN(num("amount"))) throw new Error("Enter an amount.");
      row = { frequency: d.get("frequency") === "monthly" ? "monthly" : "once", ends_on: d.get("frequency") === "monthly" ? str("ends_on") : null, spent_on: d.get("spent_on") || todayStr(), amount: num("amount"), category: d.get("category"), business: d.get("business"), paid_by: d.get("paid_by"), notes: str("notes"), receipt_path: existing.receipt_path || null };
      const file = d.get("receipt_file"); if (file && file.size) row.receipt_path = await S.be.upload(file);
    }
    if (id) row.id = id;
    await S.be.save(t, row);
    $("#dlg").close(); await refresh(); S.msg = "Saved."; render();
  } catch (x) { btn.disabled = false; alert(x.message || "Could not save."); }
});

function passwordView(err = "") {
  app.innerHTML = `<div class="login"><h1>Clear Sites <span>CRM</span></h1><p class="mut">Choose your password (at least 10 characters).</p><form id="pf"><label>New password<input name="pw" type="password" autocomplete="new-password" minlength="10" required></label><button class="btn" type="submit">Save password</button>${err ? `<p class="err" role="alert">${esc(err)}</p>` : ""}</form></div>`;
  $("#pf").addEventListener("submit", async (e) => { e.preventDefault(); try { await S.be.setPassword(new FormData(e.target).get("pw")); await boot(true); } catch (x) { passwordView(x.message); } });
}

async function boot(already) {
  if (!already) S.be = await getBackend();
  if (S.be.needsPassword && S.be.needsPassword()) return passwordView();
  S.me = await S.be.session();
  if (!S.me) return loginView();
  if (S.me.role === "none") { app.innerHTML = `<div class="login"><h1>No access</h1><p class="mut">${esc(S.me.name)} is signed in but is not on the team list. Ask the owner to add you.</p><button class="btn" id="out2">Sign out</button></div>`; $("#out2").onclick = () => S.be.logout(); return; }
  S.team = Object.fromEntries((await S.be.team()).map((t) => [t.user_id, t.name]));
  await refresh(); render();
}
boot().catch((e) => { app.innerHTML = `<div class="login"><h1>Could not start</h1><p class="err">${esc(e.message)}</p></div>`; });
