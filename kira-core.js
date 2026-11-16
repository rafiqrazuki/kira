// Kira's sums and data rules, ported from the PC version (wealth.py).
// Everything works on one plain JSON document, the one stored in Supabase.
// Loaded by index.html as a normal script (window.Kira) and by test.js under Node (require).
(function (root) {
  "use strict";

  // account kinds; the kind is also the allocation bucket. Debt kinds count against net worth.
  const ASSET_TYPES = ["EPF", "ASB", "Tabung Haji", "Bank", "Fixed deposit", "Unit trust", "Stocks", "PRS",
    "Gold", "Crypto", "Property", "Other asset"];
  const DEBT_TYPES = ["Home loan", "Car loan", "Personal loan", "Credit card", "PTPTN", "Other debt"];
  const TYPES = ASSET_TYPES.concat(DEBT_TYPES);
  const LIABILITIES = new Set(DEBT_TYPES);
  const NOT_INVESTED = new Set(["Bank", "Property", "Other asset"]);   // left out of the retirement starting figure
  const EXPENSE_CATS = ["Makan", "Groceries", "Housing", "Utilities", "Petrol & toll", "Transport",
    "Phone & internet", "Insurance & takaful", "Family & parents", "Children & school",
    "Zakat & sedekah", "Health", "Shopping", "Holidays & fun", "Loan payments", "Others"];
  const INCOME_CATS = ["Salary", "Bonus", "Side income", "Dividends", "Rental", "Other income"];
  // EPF Retirement Income Adequacy framework, savings by age 60 (in force from 1 Jan 2026).
  const EPF_TARGETS = [["Basic", 390000], ["Adequate", 650000], ["Enhanced", 1300000]];
  // Zakat: 2.5% on savings of these kinds. Tabung Haji pays zakat for its depositors; EPF is due on withdrawal.
  const ZAKAT_TYPES = new Set(["Bank", "Fixed deposit", "ASB", "Unit trust", "Stocks", "Gold", "Crypto"]);
  const ZAKAT_RATE = 0.025;
  // Resident individual income tax, years of assessment 2023 to 2026: [top of band, % on that slice].
  const TAX_BANDS = [[5000, 0], [20000, 1], [35000, 3], [50000, 6], [70000, 11], [100000, 19],
    [400000, 25], [600000, 26], [2000000, 28], [Infinity, 30]];

  const PLAN_DEFAULTS = {
    age: 30, retire_age: 60, end_age: 85,
    salary: 5000, salary_growth: 3, epf_employee: 11, epf_employer: 13,
    other_monthly: 0, savings: null,              // null = investments from the accounts
    return_pct: 5.5, retire_return_pct: 4, inflation: 3, spend: 3000,
    crash_age: 0, crash_pct: 30,                  // crash_age 0 = no crash
    efund_months: 6, monthly_expense: 0,          // 0 = average spending from the budget
    debt_extra: 0,
    zakat_nisab: 38748,                           // Selangor (LZS), Jul-Dec 2026; differs by state
    zakat_income: null, zakat_deduct: 0,          // null = salary x 12; deduct 0 = gross method
    tax_income: null, tax_reliefs: 0, tax_pcb: 0,
    tax_zakat: null,                              // null = the zakat worked out here
  };
  const INT_KEYS = new Set(["age", "retire_age", "end_age", "crash_age", "efund_months"]);
  const PCT_KEYS = new Set(["salary_growth", "epf_employee", "epf_employer", "return_pct", "retire_return_pct",
    "inflation", "crash_pct"]);

  const r2 = x => Math.round(x * 100) / 100;
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const sum = xs => xs.reduce((s, x) => s + x, 0);
  const pad = n => String(n).padStart(2, "0");
  const clean = s => String(s || "").trim().slice(0, 200);

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function num(v, lo = null, hi = null) {
    const f = typeof v === "number" ? v : typeof v === "boolean" ? Number(v)
      : typeof v === "string" && v.trim() !== "" ? Number(v.trim()) : NaN;
    if (!Number.isFinite(f) || (lo !== null && f < lo) || (hi !== null && f > hi)) {
      throw new Error(`Number out of range: ${v}`);
    }
    return f;
  }

  function iso(d) {
    if (!d) return today();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d));
    const t = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (!t || t.getUTCFullYear() !== +m[1] || t.getUTCMonth() !== +m[2] - 1 || t.getUTCDate() !== +m[3]) {
      throw new Error(`Not a date: ${d}`);
    }
    return m[0];
  }

  function intId(v) {
    const n = typeof v === "number" ? v : Number(String(v));
    if (!Number.isInteger(n)) throw new Error(`Not an id: ${v}`);
    return n;
  }

  function emptyDoc() {
    return { v: 1, next: 1, accounts: [], balances: [], txns: [], budgets: {}, bills: [], paid: {}, plan: {} };
  }

  /** Check a loaded file or stored document has Kira's shape; returns it with the id counter made safe. */
  function fromFile(d) {
    const lists = ["accounts", "balances", "txns", "bills"];
    if (!d || d.v !== 1 || lists.some(k => !Array.isArray(d[k]))
      || [d.budgets, d.paid, d.plan].some(o => !o || typeof o !== "object" || Array.isArray(o))) {
      throw new Error("That file is not a copy of Kira.");
    }
    const ids = lists.flatMap(k => d[k].map(x => intId(x.id)));
    return { ...emptyDoc(), ...d, next: Math.max(intId(d.next || 1), ...ids.map(i => i + 1)) };
  }

  // ---- data rules ----------------------------------------------------------

  function addAccount(doc, name, type = "Other asset", institution = "") {
    if (!name || !String(name).trim()) throw new Error("Give the account a name.");
    if (!TYPES.includes(type)) type = "Other asset";
    const id = doc.next++;
    doc.accounts.push({ id, name: String(name).trim(), type, institution: String(institution || "").trim(),
      rate: 0, monthly: 0, efund: type === "Bank" ? 1 : 0 });
    return id;
  }

  /** Edit a debt's terms or an asset's emergency-fund tick. */
  function updateAccount(doc, accountId, patch) {
    const a = doc.accounts.find(x => x.id === intId(accountId));
    for (const [k, v] of Object.entries(patch)) {
      let val;
      if (k === "efund") val = v ? 1 : 0;
      else if (k === "rate") val = num(v || 0, 0, 100);
      else if (k === "monthly") val = num(v || 0, 0);
      else continue;
      if (a) a[k] = val;
    }
  }

  function addBalance(doc, accountId, amount, asOf) {
    const aid = intId(accountId);
    if (!doc.accounts.some(a => a.id === aid)) throw new Error("That account no longer exists.");
    const b = { account_id: aid, as_of: iso(asOf), amount: num(amount) };
    doc.balances.push({ id: doc.next++, ...b });
  }

  function deleteAccount(doc, accountId) {
    const id = intId(accountId);
    doc.accounts = doc.accounts.filter(a => a.id !== id);
    doc.balances = doc.balances.filter(b => b.account_id !== id);
  }

  function addTxn(doc, kind, category, amount, asOf, note) {
    kind = kind === "in" ? "in" : "out";
    const cats = kind === "in" ? INCOME_CATS : EXPENSE_CATS;
    if (!cats.includes(category)) category = cats[cats.length - 1];
    const t = { as_of: iso(asOf), kind, category, amount: num(amount, 0.01), note: clean(note) };
    doc.txns.push({ id: doc.next++, ...t });
  }

  function deleteTxn(doc, txnId) {
    const id = intId(txnId);
    doc.txns = doc.txns.filter(t => t.id !== id);
  }

  /** Monthly limit for a spending category; 0 removes it. */
  function setBudget(doc, category, amount) {
    if (!EXPENSE_CATS.includes(category)) throw new Error("Unknown category.");
    amount = num(amount || 0, 0);
    if (amount) doc.budgets[category] = amount;
    else delete doc.budgets[category];
  }

  function addBill(doc, grp, name, amount, detail, ref, ends) {
    if (!clean(name)) throw new Error("Give the commitment a name.");
    const b = { grp: clean(grp) || "Other", name: clean(name), detail: clean(detail), ref: clean(ref),
      ends: clean(ends), amount: num(amount || 0, 0) };
    const id = doc.next++;
    doc.bills.push({ id, ...b });
    return id;
  }

  function updateBill(doc, billId, amount) {
    const b = doc.bills.find(x => x.id === intId(billId)), v = num(amount || 0, 0);
    if (b) b.amount = v;
  }

  function deleteBill(doc, billId) {
    const id = intId(billId);
    doc.bills = doc.bills.filter(b => b.id !== id);
    delete doc.paid[id];
  }

  function setPaid(doc, billId, ym, paid) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(ym))) throw new Error("Month must look like 2026-11.");
    const id = intId(billId);
    if (!doc.bills.some(b => b.id === id)) throw new Error("That commitment no longer exists.");
    const months = (doc.paid[id] || []).filter(m => m !== ym);
    if (paid) months.push(ym);
    if (months.length) doc.paid[id] = months.sort();
    else delete doc.paid[id];
  }

  /** Every commitment with its 12 paid ticks for one year, and the monthly total. */
  function bills(doc, year) {
    const rows = doc.bills.slice().sort((a, b) => a.id - b.id).map(b => {
      const ticked = new Set((doc.paid[b.id] || []).filter(m => m.startsWith(`${year}-`)).map(m => +m.slice(5)));
      return { ...b, paid: Array.from({ length: 12 }, (_, i) => ticked.has(i + 1)) };
    });
    // shortcut: every bill counts in the monthly total, yearly ones too (as in the source
    // spreadsheet). Add a frequency field if a true "still to pay this month" figure is wanted.
    return { year, rows, total: r2(sum(rows.map(r => r.amount))) };
  }

  function getPlan(doc) {
    return { ...PLAN_DEFAULTS, ...doc.plan };
  }

  function setPlan(doc, patch) {
    const p = getPlan(doc);
    for (const [k, v] of Object.entries(patch)) {
      if (!Object.prototype.hasOwnProperty.call(PLAN_DEFAULTS, k)) continue;
      if (v === null || v === undefined || v === "") {
        p[k] = PLAN_DEFAULTS[k];                    // blank = back to the default
      } else {
        const f = num(v, 0, PCT_KEYS.has(k) ? 100 : INT_KEYS.has(k) ? 120 : 1e12);
        p[k] = INT_KEYS.has(k) ? Math.trunc(f) : f;
      }
    }
    if (!(p.age < p.end_age && p.retire_age <= p.end_age)) {
      throw new Error("Plan-until age must be above your age and not below your retirement age.");
    }
    doc.plan = p;
  }

  /** The newest balance of an account, optionally as of a date. */
  function latest(doc, accountId, upTo) {
    let best = null;
    for (const b of doc.balances) {
      if (b.account_id !== accountId || (upTo && b.as_of > upTo)) continue;
      if (!best || b.as_of > best.as_of || (b.as_of === best.as_of && b.id > best.id)) best = b;
    }
    return best;
  }

  /** One row per account: its most recent balance (0 if none). */
  function latestBalances(doc) {
    return doc.accounts.map(a => {
      const b = latest(doc, a.id);
      return { id: a.id, name: a.name, type: a.type, institution: a.institution, rate: a.rate,
        monthly: a.monthly, efund: a.efund, amount: b ? b.amount : 0, as_of: b ? b.as_of : null };
    }).sort((x, y) => cmp(x.type, y.type) || cmp(x.name, y.name));
  }

  const signed = (type, amount) => (LIABILITIES.has(type) ? -amount : amount);

  /** Net worth per date = sum over accounts of each one's newest balance on or before that date. */
  function netWorthHistory(doc) {
    const dates = [...new Set(doc.balances.map(b => b.as_of))].sort();
    return dates.map(d => {
      let total = 0;
      for (const a of doc.accounts) {
        const b = latest(doc, a.id, d);
        if (b) total += signed(a.type, b.amount);
      }
      return { date: d, net_worth: r2(total) };
    });
  }

  /** Money in, money out and spending per category for one month (YYYY-MM). */
  function monthSummary(doc, ym) {
    const txns = doc.txns.filter(t => t.as_of.slice(0, 7) === ym)
      .sort((a, b) => cmp(b.as_of, a.as_of) || b.id - a.id)
      .map(t => ({ id: t.id, as_of: t.as_of, kind: t.kind, category: t.category, amount: t.amount, note: t.note }));
    const spent = {};
    for (const t of txns) if (t.kind === "out") spent[t.category] = r2((spent[t.category] || 0) + t.amount);
    const limits = doc.budgets;
    const cats = [...new Set([...Object.keys(spent), ...Object.keys(limits)])]
      .sort((a, b) => (spent[b] || 0) - (spent[a] || 0) || cmp(a, b))
      .map(c => ({ category: c, spent: spent[c] || 0, budget: limits[c] || 0 }));
    return { month: ym, txns, cats,
      income: r2(sum(txns.filter(t => t.kind === "in").map(t => t.amount))),
      spent: r2(sum(Object.values(spent))) };
  }

  /** Average spending over the last 3 finished months that have entries; else this month so far. */
  function avgMonthlySpend(doc, todayIso) {
    const ym = (todayIso || today()).slice(0, 7), sums = {};
    for (const t of doc.txns) {
      if (t.kind === "out") sums[t.as_of.slice(0, 7)] = (sums[t.as_of.slice(0, 7)] || 0) + t.amount;
    }
    const months = Object.keys(sums).sort().reverse();
    let use = months.filter(m => m < ym).slice(0, 3).map(m => sums[m]);
    if (!use.length) use = months.filter(m => m === ym).map(m => sums[m]);
    return use.length ? r2(sum(use) / use.length) : 0;
  }

  // ---- calculators ---------------------------------------------------------

  /** Month-by-month payoff. debts: [{balance, rate (% a year), monthly}].
   *  roll=true is the avalanche plan: `extra` plus every finished debt's payment goes to the
   *  highest-rate debt still open. roll=false pays each debt only its own payment. */
  function payoff(debts, extra = 0, roll = true, cap = 600) {
    // shortcut: every debt is treated as reducing-balance interest; flat-rate car loans
    // need their effective rate typed in. Upgrade if rule-of-78 settlement figures matter.
    const bal = debts.map(d => Number(d.balance));
    const order = debts.map((_, i) => i).sort((i, j) => debts[j].rate - debts[i].rate);
    const done = {};
    let interest = 0, m = 0;
    while (bal.some(b => b > 0.005) && m < cap) {
      m += 1;
      let pool = Number(extra);
      debts.forEach((d, i) => {
        if (bal[i] <= 0.005) { pool += roll ? d.monthly : 0; return; }
        const charge = bal[i] * d.rate / 1200;
        interest += charge;
        const pay = Math.min(d.monthly, bal[i] + charge);
        bal[i] += charge - pay;
        if (roll) pool += d.monthly - pay;
      });
      for (const i of order) {
        const pay = Math.min(pool, Math.max(bal[i], 0));
        bal[i] -= pay;
        pool -= pay;
      }
      bal.forEach((b, i) => { if (b <= 0.005 && !(i in done)) done[i] = m; });
    }
    const stuck = bal.some(b => b > 0.005);
    return { months: stuck ? null : m, interest: stuck ? null : r2(interest),
      per: debts.map((_, i) => (i in done ? done[i] : null)) };
  }

  /** Savings by age in future ringgit, one step a year: grow, then add contributions
   *  (working years) or take out inflation-adjusted spending (retired years). */
  function project(p, start) {
    // shortcut: fixed yearly returns, no random markets. Upgrade to Monte Carlo if a
    // probability of success is wanted instead of a single line.
    const r = p.return_pct / 100, rr = p.retire_return_pct / 100;
    const inf = p.inflation / 100, g = p.salary_growth / 100;
    const epf = (p.epf_employee + p.epf_employer) / 100;
    const stopWork = Math.max(p.retire_age, p.age);
    const rows = [];
    let bal = Number(start), runsOut = null, needed = 0;
    for (let age = p.age; age <= p.end_age; age++) {
      const y = age - p.age;
      rows.push({ age, balance: r2(bal) });
      if (p.crash_age && age === p.crash_age) bal *= 1 - p.crash_pct / 100;
      if (age < p.retire_age) {
        bal = bal * (1 + r) + 12 * (p.salary * (1 + g) ** y * epf + p.other_monthly);
      } else {
        const need = 12 * p.spend * (1 + inf) ** y;
        needed += need / (1 + rr) ** (age - stopWork);   // value at retirement of this year's spending
        if (bal < need) { runsOut = runsOut || age; bal = 0; }
        else bal = (bal - need) * (1 + rr);
      }
    }
    const at = {};
    for (const x of rows) at[x.age] = x.balance;
    const todays = a => r2(at[a] / (1 + inf) ** (a - p.age));
    return { rows, at_retire: at[stopWork], at_retire_today: todays(stopWork), needed: r2(needed),
      gap: r2(needed - at[stopWork]), runs_out: runsOut, at60_today: 60 in at ? todays(60) : null };
  }

  /** 2.5% of the year's income after deductions, and of savings. Each is due only from nisab up. */
  function zakat(income, deduct, wealth, nisab) {
    // shortcut: savings use the latest balance and one combined nisab test. States differ
    // (end-of-haul balance vs lowest balance, per-type nisab); upgrade if your state's rule matters.
    const net = Math.max(income - deduct, 0);
    const onIncome = net >= nisab ? r2(net * ZAKAT_RATE) : 0;
    const onWealth = wealth >= nisab ? r2(wealth * ZAKAT_RATE) : 0;
    return { income, net, wealth, nisab, on_income: onIncome, on_wealth: onWealth, total: r2(onIncome + onWealth) };
  }

  function taxOn(chargeable) {
    let tax = 0, lo = 0;
    for (const [hi, pct] of TAX_BANDS) {
      if (chargeable > lo) tax += (Math.min(chargeable, hi) - lo) * pct / 100;
      lo = hi;
    }
    return r2(tax);
  }

  /** Resident individual tax for one year: reliefs, bands, RM400 rebate, then zakat as a rebate. */
  function incomeTax(income, epfPct, otherReliefs, zakatPaid, pcb) {
    const epf = r2(Math.min(4000, income * epfPct / 100));
    const chargeable = Math.max(income - 9000 - epf - otherReliefs, 0);
    const gross = taxOn(chargeable);
    const rebate = chargeable <= 35000 ? Math.min(gross, 400) : 0;
    const zakatRebate = Math.min(zakatPaid, gross - rebate);   // zakat can only bring tax down to zero
    const tax = r2(gross - rebate - zakatRebate);
    return { income, individual: 9000, epf, other: otherReliefs, chargeable, gross, rebate,
      zakat_rebate: zakatRebate, tax, pcb, balance: r2(tax - pcb) };
  }

  /** Everything the page shows, worked out from the document. */
  function state(doc, month, todayIso, year) {
    const td = todayIso || today();
    if (!(month && /^\d{4}-\d{2}$/.test(month))) month = td.slice(0, 7);
    year = year && /^20\d\d$/.test(String(year)) ? Number(year) : Number(td.slice(0, 4));
    const accounts = latestBalances(doc).map(a => ({ ...a, debt: LIABILITIES.has(a.type) }));
    const own = accounts.filter(a => !a.debt);
    const owing = accounts.filter(a => a.debt && a.amount > 0);
    const alloc = {};
    for (const a of own) if (a.amount > 0) alloc[a.type] = r2((alloc[a.type] || 0) + a.amount);
    const assets = r2(sum(own.map(a => a.amount)));
    const debts = r2(sum(accounts.filter(a => a.debt).map(a => a.amount)));
    const plan = getPlan(doc);

    const loans = owing.map(a => ({ balance: a.amount, rate: a.rate, monthly: a.monthly }));
    const base = payoff(loans, 0, false);
    owing.forEach((a, i) => { a.months = base.per[i]; });

    const yearPay = plan.salary * 12;
    const zk = zakat(plan.zakat_income === null ? yearPay : plan.zakat_income, plan.zakat_deduct,
      r2(sum(own.filter(a => ZAKAT_TYPES.has(a.type) && a.amount > 0).map(a => a.amount))), plan.zakat_nisab);
    const tax = incomeTax(plan.tax_income === null ? yearPay : plan.tax_income, plan.epf_employee,
      plan.tax_reliefs, plan.tax_zakat === null ? zk.total : plan.tax_zakat, plan.tax_pcb);

    const avg = avgMonthlySpend(doc, td);
    const monthly = plan.monthly_expense || avg;
    const fund = r2(sum(own.filter(a => a.efund).map(a => a.amount)));

    const auto = r2(sum(own.filter(a => !NOT_INVESTED.has(a.type)).map(a => a.amount)));
    const start = plan.savings === null ? auto : plan.savings;
    const retire = project({ ...plan, crash_age: 0 }, start);
    Object.assign(retire, { auto, crash: plan.crash_age ? project(plan, start) : null,
      monthly_now: r2(plan.salary * (plan.epf_employee + plan.epf_employer) / 100 + plan.other_monthly) });
    return { accounts, net_worth: r2(assets - debts), assets, debts, allocation: alloc,
      history: netWorthHistory(doc), asset_types: ASSET_TYPES, debt_types: DEBT_TYPES,
      expense_cats: EXPENSE_CATS, income_cats: INCOME_CATS,
      budget: monthSummary(doc, month), bills: bills(doc, year),
      debt: { base, plan: payoff(loans, plan.debt_extra) },
      zakat: zk, tax, year_pay: yearPay,
      fund: { fund, avg, monthly, months: plan.efund_months, target: r2(monthly * plan.efund_months) },
      plan, retire, epf_targets: EPF_TARGETS };
  }

  /** The PC version's API calls, applied to the document. Throws an Error whose message the page shows. */
  function apply(doc, method, path, b) {
    b = b || {};
    const id = () => path.slice(path.lastIndexOf("/") + 1);
    const has = v => v !== undefined && v !== null && v !== "";
    if (method === "POST") {
      if (path === "/api/account") {
        const aid = addAccount(doc, b.name || "", b.type, b.institution || "");
        if (has(b.amount)) addBalance(doc, aid, b.amount, b.as_of);
      } else if (path.startsWith("/api/account/")) updateAccount(doc, id(), b);
      else if (path === "/api/balance") addBalance(doc, b.account_id, b.amount, b.as_of);
      else if (path === "/api/txn") addTxn(doc, b.kind, b.category, b.amount, b.as_of, b.note);
      else if (path === "/api/budget") setBudget(doc, b.category, b.amount);
      else if (path === "/api/plan") setPlan(doc, b);
      else if (path === "/api/bill") addBill(doc, b.grp, b.name, b.amount, b.detail, b.ref, b.ends);
      else if (path.startsWith("/api/bill/")) updateBill(doc, id(), b.amount);
      else if (path === "/api/paid") setPaid(doc, b.bill_id, b.ym, b.paid);
      else throw new Error("not found");
    } else if (method === "DELETE") {
      const drop = { account: deleteAccount, txn: deleteTxn, bill: deleteBill }[path.split("/")[2]];
      if (!drop) throw new Error("not found");
      drop(doc, id());
    } else throw new Error("not found");
  }

  const Kira = { ASSET_TYPES, DEBT_TYPES, EXPENSE_CATS, INCOME_CATS, EPF_TARGETS, PLAN_DEFAULTS,
    today, num, iso, emptyDoc, fromFile, addAccount, updateAccount, addBalance, deleteAccount, addTxn,
    deleteTxn, setBudget, addBill, updateBill, deleteBill, setPaid, bills, getPlan, setPlan,
    latestBalances, netWorthHistory, monthSummary, avgMonthlySpend, payoff, project, zakat, taxOn,
    incomeTax, state, apply };
  if (typeof module !== "undefined" && module.exports) module.exports = Kira;
  else root.Kira = Kira;
})(typeof window !== "undefined" ? window : globalThis);
