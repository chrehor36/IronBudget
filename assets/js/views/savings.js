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

const IB_VIEW_SAVINGS = {
  title: "Savings",
  render(container, data) {
    const agg = data.agg;
    container.innerHTML = `<div class="page-header"><h1>Savings goal</h1>
      <div class="sub">Track progress toward a savings target, at the pace your data shows.</div></div>
      <div id="savings-body"><div class="empty-state">Loading...</div></div>`;

    IB_API.call("get_savings_goal").then((goal) => {
      const host = document.getElementById("savings-body");
      if (!goal) {
        host.innerHTML = `<div class="empty-state">
          <p>You haven't set a savings goal yet.</p>
          <button class="btn primary" id="sg-set">Set a savings goal</button>
        </div>`;
        document.getElementById("sg-set").addEventListener("click", () =>
          ib_openSavingsGoalModal(agg, null, () => IB_VIEW_SAVINGS.render(container, data)));
        return;
      }
      ib_renderSavingsGoal(host, agg, goal, () => IB_VIEW_SAVINGS.render(container, data));
    });
  },
};
