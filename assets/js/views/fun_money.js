function ib_monthLabel(k) {
  const [y, m] = k.split("-");
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: "short", year: "numeric" });
}

function ib_spentInMonth(agg, monthKey, categories) {
  const byCat = (agg.m_cat_adj && agg.m_cat_adj[monthKey]) || {};
  return categories.reduce((sum, c) => sum + (byCat[c] || 0), 0);
}

function ib_renderFunMoney(host, agg, fm, onChange) {
  const months = agg.months;
  const curMonth = months[months.length - 1];
  const spent = ib_spentInMonth(agg, curMonth, fm.categories);
  const budget = fm.monthly_budget;
  const pct = budget > 0 ? (spent / budget) * 100 : 0;
  const remaining = budget - spent;
  const color = pct >= 100 ? "var(--status-critical)" : pct >= 80 ? "var(--status-warning)" : "var(--status-good)";

  let html = `<div class="card">
    <h2>This month - ${ib_monthLabel(curMonth)}</h2>
    <div class="kpi-row" style="margin-bottom:14px;">
      <div class="kpi-tile"><div class="label">Budget</div><div class="value">${IB_CHARTS.fmtMoney(budget)}</div></div>
      <div class="kpi-tile"><div class="label">Spent</div><div class="value">${IB_CHARTS.fmtMoney(spent)}</div></div>
      <div class="kpi-tile"><div class="label">${remaining >= 0 ? "Remaining" : "Over budget"}</div><div class="value" style="color:${color};">${IB_CHARTS.fmtMoney(Math.abs(remaining))}</div></div>
    </div>
    <div class="progress-bar" style="height:10px;"><div style="width:${Math.min(100, pct)}%; background:${color};"></div></div>
    <div class="sub" style="margin:6px 0 12px;">${pct.toFixed(0)}% of this month's budget used</div>
    <div class="note" style="font-size:11.5px; color:var(--ink-muted);">Categories counted: ${fm.categories.join(", ")}</div>
    <button class="btn" id="fm-edit" style="margin-top:12px;">Edit</button>
  </div>`;
  html += `<div class="card"><h2>Budget vs. actual by month</h2><div id="fm-bar"></div></div>`;
  host.innerHTML = html;
  document.getElementById("fm-edit").addEventListener("click", () => ib_openFunMoneyModal(agg, fm, onChange));

  const labels = months.map(ib_monthLabel);
  IB_CHARTS.groupedBar(document.getElementById("fm-bar"), labels, [
    { label: "Budget", color: "var(--series-4)", values: months.map(() => budget) },
    { label: "Spent", color: "var(--series-1)", values: months.map((k) => ib_spentInMonth(agg, k, fm.categories)) },
  ]);
}

function ib_openFunMoneyModal(agg, existing, onSaved) {
  const dlg = document.getElementById("modal-household");
  const cats = (agg.cat_sorted || []).map(([c]) => c);
  const selected = new Set(existing ? existing.categories : []);
  const checks = cats.map((c) => `
    <label style="display:flex; align-items:center; gap:8px; padding:5px 0; font-size:13px; color:var(--ink-secondary);">
      <input type="checkbox" value="${c}" ${selected.has(c) ? "checked" : ""}> ${c}
    </label>`).join("");
  dlg.innerHTML = `<h3>${existing ? "Edit" : "Set up"} fun money</h3>
    <div class="field"><label>Monthly budget</label><input type="number" id="fm-budget" value="${existing ? existing.monthly_budget : 300}" step="0.01"></div>
    <div class="field"><label>Categories that count as fun money</label>
      <div style="max-height:220px; overflow-y:auto; border:1px solid var(--border-hairline); border-radius:6px; padding:6px 10px;">${checks}</div>
    </div>
    <div class="actions"><button class="btn" id="fm-cancel">Cancel</button><button class="btn primary" id="fm-save">Save</button></div>`;
  dlg.showModal();
  document.getElementById("fm-cancel").addEventListener("click", () => dlg.close());
  document.getElementById("fm-save").addEventListener("click", async () => {
    const monthly_budget = parseFloat(document.getElementById("fm-budget").value) || 0;
    const categories = [...dlg.querySelectorAll('input[type="checkbox"]:checked')].map((el) => el.value);
    await IB_API.call("save_fun_money", { monthly_budget, categories });
    dlg.close();
    onSaved();
  });
}

const IB_VIEW_FUN_MONEY = {
  title: "Fun Money",
  render(container, data) {
    const agg = data.agg;
    container.innerHTML = `<div class="page-header"><h1>Fun money</h1>
      <div class="sub">A discretionary allowance, tracked against the categories you pick.</div></div>
      <div id="fm-body"><div class="empty-state">Loading...</div></div>`;

    IB_API.call("get_fun_money").then((fm) => {
      const host = document.getElementById("fm-body");
      if (!fm || !fm.categories || !fm.categories.length) {
        host.innerHTML = `<div class="empty-state">
          <p>You haven't set up a fun money budget yet.</p>
          <button class="btn primary" id="fm-set">Set up fun money</button>
        </div>`;
        document.getElementById("fm-set").addEventListener("click", () =>
          ib_openFunMoneyModal(agg, fm, () => IB_VIEW_FUN_MONEY.render(container, data)));
        return;
      }
      ib_renderFunMoney(host, agg, fm, () => IB_VIEW_FUN_MONEY.render(container, data));
    });
  },
};
