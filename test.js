// Checks Kira's sums by hand-checkable examples. Run: node test.js
const assert = require("assert");
const K = require("./kira-core.js");
const eq = assert.deepStrictEqual;
const day = "2026-04-10";

const doc = K.emptyDoc();
const a = K.addAccount(doc, "My KWSP", "EPF", "KWSP");
const b = K.addAccount(doc, "Myvi", "Car loan", "Bank");
K.addBalance(doc, a, 10000, "2026-01-01");
K.addBalance(doc, a, 12000, "2026-02-01");                 // newer wins for "latest"
K.addBalance(doc, b, 5000, "2026-01-01");
let s = K.state(doc, null, day);
eq(s.net_worth, 7000);                                     // asset minus liability
eq(s.allocation, { EPF: 12000 });                          // loan left out of the allocation
eq(s.history[0], { date: "2026-01-01", net_worth: 5000 });
eq(s.retire.auto, 12000);                                  // EPF counts as invested

// budget: month totals, category vs limit, average spend
K.addTxn(doc, "in", "Salary", 5000, "2026-03-01");
K.addTxn(doc, "out", "Makan", 100, "2026-03-05");
K.addTxn(doc, "out", "Makan", 50, "2026-03-06");
K.setBudget(doc, "Makan", 120);
const m = K.monthSummary(doc, "2026-03");
eq([m.income, m.spent], [5000, 150]);
eq(m.cats, [{ category: "Makan", spent: 150, budget: 120 }]);
eq(K.avgMonthlySpend(doc, day), 150);

// emergency fund: bank accounts count by default, target = months x spending
const c = K.addAccount(doc, "Maybank", "Bank");
K.addBalance(doc, c, 9000, "2026-02-01");
const f = K.state(doc, null, day).fund;
eq([f.fund, f.monthly, f.target], [9000, 150, 900]);

// debt payoff
const d = (balance, rate, monthly) => ({ balance, rate, monthly });
eq(K.payoff([d(1200, 0, 100)], 0, false).months, 12);
eq(K.payoff([d(1200, 0, 100)], 100).months, 6);
eq(K.payoff([d(1000, 12, 1010)]), { months: 1, interest: 10, per: [1] });   // 1% a month on RM1,000
eq(K.payoff([d(1000, 12, 5)]).months, null);                                // payment below interest
eq(K.payoff([d(1000, 0, 100), d(1000, 12, 100)], 1000).per, [2, 1]);        // extra hits the 12% debt first

// retirement: flat numbers so the sums are checkable by hand
const flat = { ...K.PLAN_DEFAULTS, salary: 5000, spend: 1000, salary_growth: 0, return_pct: 0,
  retire_return_pct: 0, inflation: 0 };
const r = K.project(flat, 0);
eq([r.at_retire, r.needed, r.gap], [432000, 312000, -120000]);   // RM1,200 x 12 x 30; RM12,000 x 26
const crash = K.project({ ...flat, crash_age: 50, crash_pct: 50, spend: 2000 }, 0);
eq([crash.at_retire, crash.runs_out], [288000, 72]);
assert.throws(() => K.setPlan(doc, { end_age: 20 }), /Plan-until age/);

// zakat and income tax
eq(K.zakat(60000, 0, 10000, 38748).total, 1500);
eq(K.zakat(60000, 30000, 40000, 38748).on_wealth, 1000);         // income below nisab, savings above
eq([K.taxOn(5000), K.taxOn(35000), K.taxOn(50000), K.taxOn(100000)], [0, 600, 1500, 9400]);
eq(K.incomeTax(60000, 11, 0, 0, 0).tax, 1320);                   // chargeable 47,000
eq(K.incomeTax(60000, 11, 0, 1500, 0).tax, 0);                   // zakat rebate stops at zero
eq(K.incomeTax(40000, 11, 0, 0, 0).tax, 0);                      // RM360 wiped by the RM400 rebate

// commitments: total, ticks per year, cascade on delete
const u = K.addBill(doc, "Utility", "Unifi", 151.75);
const v = K.addBill(doc, "Loan", "CIMB", 1845);
K.setPaid(doc, u, "2026-01", true);
K.setPaid(doc, u, "2026-03", true);
K.setPaid(doc, u, "2026-03", false);
K.setPaid(doc, u, "2025-12", true);                              // another year stays out
const bl = K.bills(doc, 2026);
eq([bl.total, bl.rows.map(x => x.paid.filter(Boolean).length)], [1996.75, [1, 0]]);
K.deleteBill(doc, u);
eq(doc.paid, {});
assert.throws(() => K.setPaid(doc, v, "2026-13", true), /Month/);

// the page's calls, and files
K.apply(doc, "POST", "/api/account", { name: "ASB", type: "ASB", amount: "2500", as_of: "2026-03-01" });
K.apply(doc, "DELETE", "/api/account/" + b);
eq(K.state(doc, null, day).net_worth, 12000 + 9000 + 2500);
assert.throws(() => K.apply(doc, "POST", "/api/balance", { account_id: 999, amount: 1 }), /no longer exists/);
assert.throws(() => K.fromFile({ v: 2 }), /not a copy/);
eq(K.fromFile(JSON.parse(JSON.stringify(doc))).next, doc.next);

console.log("test ok: net worth, budget, emergency fund, debts, retirement, zakat, tax, commitments, files");
