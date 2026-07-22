function ib_monthlyPace(agg, goal) {
  if (goal.account && agg.xfer_in_by_acct && agg.xfer_in_by_acct[goal.account] !== undefined) {
    return agg.xfer_in_by_acct[goal.account] / agg.MONTHS;
  }
  return agg.net_m;
}

function ib_renderSavingsGoal(host, agg, goal, onChange) {
  const pace = ib_monthlyPace(agg, goal);
  const pct = goal.target_amount > 0 ? Math.min(100, (goal.current_amount / goal.target_amount) * 100) : 0;
  const remaining = Math.max(0, goal.target_amount - goal.current_amount);

  let paceLine;
  if (pct >= 100) {
    paceLine = "Goal reached - nice work.";
  } else if (pace <= 0) {
    paceLine = "At the current pace this goal won't be reached - spending is outpacing income right now.";
  } else {
    const months = remaining / pace;
    const eta = new Date();
    eta.setMonth(eta.getMonth() + Math.ceil(months));
    const monthsText = months < 1 ? "under a month" : `about ${Math.ceil(months)} month${Math.ceil(months) === 1 ? "" : "s"}`;
    paceLine = `At ${IB_CHARTS.fmtMoney(pace)}/mo, ${monthsText} away (~${eta.toLocaleString(undefined, { month: "short", year: "numeric" })}).`;
  }
  const paceSource = goal.account
    ? `based on money moved into ${goal.account}`
    : "based on overall monthly surplus (income minus expenses)";
  const barColor = pct >= 100 ? "var(--status-good)" : "var(--accent)";

  host.innerHTML = `
    <div class="card">
      <h2>${goal.label || "Savings goal"}</h2>
      <div class="kpi-row" style="margin-bottom:14px;">
        <div class="kpi-tile"><div class="label">Current</div><div class="value">${IB_CHARTS.fmtMoney(goal.current_amount)}</div></div>
        <div class="kpi-tile"><div class="label">Target</div><div class="value">${IB_CHARTS.fmtMoney(goal.target_amount)}</div></div>
        <div class="kpi-tile"><div class="label">Remaining</div><div class="value">${IB_CHARTS.fmtMoney(remaining)}</div></div>
      </div>
      <div class="progress-bar" style="height:10px;"><div style="width:${pct}%; background:${barColor};"></div></div>
      <div class="sub" style="margin:6px 0 12px;">${pct.toFixed(1)}% of the way there</div>
      <p style="font-size:13px; color:var(--ink-secondary); margin:0 0 4px;">${paceLine}</p>
      <p style="font-size:11.5px; color:var(--ink-muted); margin:0 0 14px;">Pace ${paceSource}. Current amount last updated ${goal.updated_at || "-"}.</p>
      <button class="btn" id="sg-edit">Edit goal</button>
    </div>`;
  document.getElementById("sg-edit").addEventListener("click", () => ib_openSavingsGoalModal(agg, goal, onChange));
}

function ib_openSavingsGoalModal(agg, existing, onSaved) {
  // Shared themed <dialog> also used for editing household + fun money -
  // only one settings modal is ever open at a time.
  const dlg = document.getElementById("modal-household");
  const accounts = agg.accounts || [];
  const acctOptions = accounts.map((a) =>
    `<option value="${a}" ${existing && existing.account === a ? "selected" : ""}>${a}</option>`).join("");
  dlg.innerHTML = `<h3>${existing ? "Edit" : "Set"} savings goal</h3>
    <div class="field"><label>Goal name</label><input type="text" id="sg-label" value="${existing ? existing.label : "Emergency fund"}"></div>
    <div class="field"><label>Current amount saved</label><input type="number" id="sg-current" value="${existing ? existing.current_amount : 0}" step="0.01"></div>
    <div class="field"><label>Target amount</label><input type="number" id="sg-target" value="${existing ? existing.target_amount : 10000}" step="0.01"></div>
    ${accounts.length > 1 ? `<div class="field"><label>Track pace using</label><select id="sg-account" class="inline-input">
      <option value="">Overall surplus (income minus expenses)</option>${acctOptions}</select></div>` : ""}
    <div class="actions"><button class="btn" id="sg-cancel">Cancel</button><button class="btn primary" id="sg-save">Save</button></div>`;
  dlg.showModal();
  document.getElementById("sg-cancel").addEventListener("click", () => dlg.close());
  document.getElementById("sg-save").addEventListener("click", async () => {
    const label = document.getElementById("sg-label").value.trim() || "Savings goal";
    const current_amount = parseFloat(document.getElementById("sg-current").value) || 0;
    const target_amount = parseFloat(document.getElementById("sg-target").value) || 0;
    const acctEl = document.getElementById("sg-account");
    const account = acctEl ? acctEl.value : "";
    await IB_API.call("save_savings_goal", { label, current_amount, target_amount, account });
    dlg.close();
    onSaved();
  });
}

// Seeds the necessary/discretionary checkbox modal before the user has ever
// reviewed it - a guess from category names alone, never the final word.
// The user's own edits (persisted via save_spend_classification) always win
// once they've reviewed it; this regex only matters for the very first,
// unconfirmed pass.
const IB_NECESSARY_HINT = /mortgage|\brent\b|utilit|insurance|health|medical|grocer|\bauto\b|loan|\btax(es)?\b|child|daycare|tuition|educat|phone|internet|\bbill|\bgas\b|fuel|doctor|dentist|pharmacy|prescription/i;

function ib_defaultNecessary(cats) {
  return cats.filter((c) => IB_NECESSARY_HINT.test(c));
}

function ib_renderSpendSplit(host, agg, classification, goal, onChange) {
  const catSorted = agg.cat_sorted || [];
  const cats = catSorted.map(([c]) => c);
  const necessarySet = new Set(classification ? classification.necessary_categories : ib_defaultNecessary(cats));
  let necessaryTotal = 0, discretionaryTotal = 0;
  const discretionaryRows = [];
  catSorted.forEach(([c, v]) => {
    if (necessarySet.has(c)) necessaryTotal += v;
    else { discretionaryTotal += v; discretionaryRows.push([c, v]); }
  });
  const necMonthly = necessaryTotal / agg.MONTHS;
  const discMonthly = discretionaryTotal / agg.MONTHS;
  const isDefault = !classification;

  let html = `<div class="card">
    <h2>Where you could cut back</h2>
    ${isDefault ? `<div class="note" style="font-size:11.5px; color:var(--ink-muted); margin:-4px 0 12px;">Best-guess split based on category names - review it below to make this accurate.</div>` : ""}
    <div class="kpi-row" style="margin-bottom:14px;">
      <div class="kpi-tile"><div class="label">Essentials / mo</div><div class="value">${IB_CHARTS.fmtMoney(necMonthly)}</div><div class="note">Housing, bills, insurance, groceries - what it costs to live</div></div>
      <div class="kpi-tile"><div class="label">Discretionary / mo</div><div class="value" style="color:var(--status-warning);">${IB_CHARTS.fmtMoney(discMonthly)}</div><div class="note">The flexible part - where cuts are actually possible</div></div>
    </div>`;

  if (discretionaryRows.length) {
    html += `<div style="font-size:12px; text-transform:uppercase; letter-spacing:0.03em; color:var(--ink-secondary); margin:16px 0 8px;">Biggest discretionary categories</div>
      <div id="split-bar"></div>`;
  }

  if (discMonthly > 0) {
    const cuts = [0.1, 0.2, 0.3];
    html += `<div style="font-size:12px; text-transform:uppercase; letter-spacing:0.03em; color:var(--ink-secondary); margin:16px 0 8px;">If you trimmed discretionary spending...</div>
      <table class="data-table"><thead><tr><th>Cut</th><th class="num">Extra saved / mo</th>${goal ? `<th class="num">New goal ETA</th>` : ""}</tr></thead><tbody>`;
    cuts.forEach((pct) => {
      const extra = discMonthly * pct;
      let etaCell = "";
      if (goal) {
        const pace = ib_monthlyPace(agg, goal) + extra;
        const remaining = Math.max(0, goal.target_amount - goal.current_amount);
        if (remaining <= 0) {
          etaCell = `<td class="num">already reached</td>`;
        } else if (pace > 0) {
          const months = remaining / pace;
          const eta = new Date();
          eta.setMonth(eta.getMonth() + Math.ceil(months));
          etaCell = `<td class="num">${eta.toLocaleString(undefined, { month: "short", year: "numeric" })}</td>`;
        } else {
          etaCell = `<td class="num">-</td>`;
        }
      }
      html += `<tr><td>${(pct * 100).toFixed(0)}%</td><td class="num">${IB_CHARTS.fmtMoney(extra)}</td>${etaCell}</tr>`;
    });
    html += `</tbody></table>`;
  }

  html += `<button class="btn" id="split-edit" style="margin-top:14px;">Review classification</button>`;
  host.innerHTML = html;

  if (discretionaryRows.length) {
    const total = discretionaryTotal;
    const barData = discretionaryRows.slice(0, 8).map(([label, value]) => ({
      label, value, pct: total ? (value / total) * 100 : 0,
    }));
    IB_CHARTS.horizontalBar(document.getElementById("split-bar"), barData);
  }
  document.getElementById("split-edit").addEventListener("click", () =>
    ib_openSpendSplitModal(agg, classification, onChange));
}

function ib_openSpendSplitModal(agg, existing, onSaved) {
  const dlg = document.getElementById("modal-household");
  const cats = (agg.cat_sorted || []).map(([c]) => c);
  const necessarySet = new Set(existing ? existing.necessary_categories : ib_defaultNecessary(cats));
  const checks = cats.map((c) => `
    <label style="display:flex; align-items:center; gap:8px; padding:5px 0; font-size:13px; color:var(--ink-secondary);">
      <input type="checkbox" value="${c}" ${necessarySet.has(c) ? "checked" : ""}> ${c}
    </label>`).join("");
  dlg.innerHTML = `<h3>Essentials vs. discretionary</h3>
    <p style="font-size:12.5px;">Check anything that's essential - an expense you need in order to live (housing, utilities, groceries, insurance...). Leave the rest unchecked - that's what counts as discretionary spending that could potentially be cut.</p>
    <div class="field">
      <div style="max-height:280px; overflow-y:auto; border:1px solid var(--border-hairline); border-radius:6px; padding:6px 10px;">${checks}</div>
    </div>
    <div class="actions"><button class="btn" id="split-cancel">Cancel</button><button class="btn primary" id="split-save">Save</button></div>`;
  dlg.showModal();
  document.getElementById("split-cancel").addEventListener("click", () => dlg.close());
  document.getElementById("split-save").addEventListener("click", async () => {
    const necessary_categories = [...dlg.querySelectorAll('input[type="checkbox"]:checked')].map((el) => el.value);
    await IB_API.call("save_spend_classification", necessary_categories);
    dlg.close();
    onSaved();
  });
}

const IB_VIEW_SAVINGS = {
  title: "Savings",
  render(container, data) {
    const agg = data.agg;
    container.innerHTML = `<div class="page-header"><h1>Savings goal</h1>
      <div class="sub">Track progress toward a savings target, at the pace your data shows.</div></div>
      <div id="savings-body"><div class="empty-state">Loading...</div></div>
      <div id="split-body"></div>`;

    Promise.all([
      IB_API.call("get_savings_goal"),
      IB_API.call("get_spend_classification"),
    ]).then(([goal, classification]) => {
      const host = document.getElementById("savings-body");
      if (!goal) {
        host.innerHTML = `<div class="empty-state">
          <p>You haven't set a savings goal yet.</p>
          <button class="btn primary" id="sg-set">Set a savings goal</button>
        </div>`;
        document.getElementById("sg-set").addEventListener("click", () =>
          ib_openSavingsGoalModal(agg, null, () => IB_VIEW_SAVINGS.render(container, data)));
      } else {
        ib_renderSavingsGoal(host, agg, goal, () => IB_VIEW_SAVINGS.render(container, data));
      }
      ib_renderSpendSplit(document.getElementById("split-body"), agg, classification, goal,
        () => IB_VIEW_SAVINGS.render(container, data));
    });
  },
};
