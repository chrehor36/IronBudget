const IB_VIEW_TRANSACTIONS = {
  title: "Transactions",
  _sortKey: "date",
  _sortDir: -1,
  render(container, data) {
    const rows = data.transactions.slice();

    const pending = window.__ironbudget._pendingTxnFilter;
    if (pending) {
      if (pending.sort_by) this._sortKey = pending.sort_by;
      if (pending.sort_dir) this._sortDir = pending.sort_dir === "asc" ? 1 : -1;
      delete window.__ironbudget._pendingTxnFilter;
    }
    const initialQuery = pending && pending.query ? pending.query : "";

    let html = `<div class="page-header"><h1>All transactions (repeats removed)</h1>
      <div class="sub">Internal = between your own accounts.</div></div>`;
    html += `<div class="card">
      <div class="field" style="max-width:320px;"><input type="text" id="txn-search" placeholder="Search description or category..." value="${initialQuery}"></div>
      <div style="overflow-x:auto;"><table class="data-table" id="txn-table"><thead><tr>
        <th data-key="date" style="cursor:pointer;">Date</th>
        <th data-key="acct" style="cursor:pointer;">Account</th>
        <th data-key="desc" style="cursor:pointer;">Description</th>
        <th data-key="cat" style="cursor:pointer;">Category</th>
        <th class="num" data-key="amt" style="cursor:pointer;">Amount</th>
        <th>Status</th><th>Flags</th>
      </tr></thead><tbody id="txn-tbody"></tbody></table></div>
    </div>`;
    container.innerHTML = html;

    const renderRows = () => {
      const q = (document.getElementById("txn-search").value || "").toLowerCase();
      let filtered = rows.filter((t) => !q || t.desc.toLowerCase().includes(q) || t.cat.toLowerCase().includes(q));
      const key = this._sortKey, dir = this._sortDir;
      filtered.sort((a, b) => {
        const av = a[key], bv = b[key];
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return 0;
      });
      const tbody = document.getElementById("txn-tbody");
      let rowsHtml = "";
      filtered.forEach((t) => {
        const flags = [t.trip ? "Trip" : "", t.reimb ? "Reimb" : "", t.internal ? "Internal" : ""].filter(Boolean).join(" ");
        const amtClass = t.amt > 0 ? "pos" : "";
        rowsHtml += `<tr><td>${t.date}</td><td>${t.acct}</td><td>${t.desc}</td><td>${t.cat}</td>
          <td class="num ${amtClass}">${IB_CHARTS.fmtMoney(t.amt)}</td><td>${t.status}</td><td>${flags}</td></tr>`;
      });
      tbody.innerHTML = rowsHtml || `<tr><td colspan="7" style="text-align:center;color:var(--ink-muted);">No matching transactions.</td></tr>`;
    };

    document.getElementById("txn-search").addEventListener("input", renderRows);
    document.querySelectorAll("#txn-table th[data-key]").forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.getAttribute("data-key");
        if (this._sortKey === key) this._sortDir *= -1;
        else { this._sortKey = key; this._sortDir = key === "date" ? -1 : 1; }
        renderRows();
      });
    });
    renderRows();
  },
};
