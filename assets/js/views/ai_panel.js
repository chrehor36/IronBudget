const IB_VIEW_AI = {
  title: "AI & Categories",
  _sortKey: "total",
  _sortDir: -1,
  render(container, data) {
    container.innerHTML = `
      <div class="page-header">
        <h1>AI &amp; Categories</h1>
        <div class="sub">IronBudget uses a local AI model to help categorize your merchants - it's already set up, nothing to configure.</div>
      </div>
      <div class="card"><h2>AI status</h2><div id="ai-models-host">Loading...</div></div>
      <div class="card"><h2>Categorize everything</h2><div id="ai-categorize-host">Loading...</div></div>
      <div class="card">
        <h2>Merchants</h2>
        <div class="sub" style="margin-bottom:10px;">Correct any category below - IronBudget remembers it for every transaction from that merchant, from now on.</div>
        <div id="ai-merchants-host">Loading...</div>
      </div>
    `;

    renderModels();
    renderCategorizeCard();
    renderMerchants();

    if (!window.__ironbudget._aiPanelProgressWrapped) {
      window.__ironbudget._aiPanelProgressWrapped = true;
      const baseOnProgress = window.__ironbudget.onAiProgress;
      window.__ironbudget.onAiProgress = function (payload) {
        const bar = document.getElementById("ai-model-progress-bar");
        const status = document.getElementById("ai-model-status-text");
        if (bar && status) {
          if (payload.phase === "download") { status.textContent = `Downloading... ${payload.pct || 0}%`; bar.style.width = (payload.pct || 0) + "%"; }
          else if (payload.phase === "done") { status.textContent = "Done."; bar.style.width = "100%"; setTimeout(renderModels, 800); }
          else if (payload.phase === "error") { status.textContent = "Download failed: " + payload.error; }
        }
        if (baseOnProgress) baseOnProgress(payload);
      };
    }

    async function renderModels() {
      const status = await IB_API.call("get_ai_status");
      const host = document.getElementById("ai-models-host");
      if (!host) return; // user navigated away before this resolved
      if (status.ready) {
        host.innerHTML = `<p style="font-size:13px;"><span style="color:var(--status-good);">Ready</span> - your local AI model is downloaded and running, fully offline.</p>`;
        return;
      }
      host.innerHTML = `<p style="font-size:13px;color:var(--ink-secondary);">Not downloaded yet (~${status.size_gb}GB, one-time).</p>
        <button class="btn primary" id="ai-download-model">Download now</button>
        <div id="ai-model-progress-wrap"></div>`;
      document.getElementById("ai-download-model").addEventListener("click", async (e) => {
        e.target.disabled = true;
        document.getElementById("ai-model-progress-wrap").innerHTML =
          `<div class="progress-bar"><div id="ai-model-progress-bar"></div></div><div id="ai-model-status-text" style="font-size:12px;color:var(--ink-muted);"></div>`;
        await IB_API.call("install_ai_model");
      });
    }

    async function renderCategorizeCard() {
      const preview = await IB_API.call("get_ai_preview");
      const host = document.getElementById("ai-categorize-host");
      if (!host) return;
      if (!preview.count) {
        host.innerHTML = `<p style="font-size:13px;color:var(--ink-secondary);">Nothing uncategorized right now (or the AI model isn't downloaded yet - see AI status above).</p>`;
        return;
      }
      const who = preview.provider === "local" ? `the local model (${preview.model})` : "Claude (cloud API)";
      host.innerHTML = `<p style="font-size:13px;">${preview.count} merchants still need a category. Ask ${who} for a guess on each one - you approve or edit every guess before anything is saved.</p>
        <button class="btn primary" id="ai-find-suggestions">Find suggestions</button>
        <div id="ai-suggestions-list"></div>`;
      document.getElementById("ai-find-suggestions").addEventListener("click", async (e) => {
        e.target.disabled = true;
        e.target.textContent = "Thinking...";
        const result = await IB_API.call("get_ai_suggestions");
        e.target.remove();
        if (!result.ok) { showMessage("Couldn't get suggestions", result.error || "Unknown error."); return; }
        renderSuggestions(result.suggestions);
      });
    }

    function renderSuggestions(suggestions) {
      const list = document.getElementById("ai-suggestions-list");
      if (!list) return;
      list.innerHTML = "";
      suggestions.forEach((s) => {
        const card = document.createElement("div");
        card.className = "ai-suggestion";
        card.innerHTML = `
          <strong>${s.label}</strong>
          <div style="font-size:12px;color:var(--ink-secondary);margin:4px 0 8px;">${s.reason || ""}</div>
          <div style="display:flex;gap:8px;align-items:center;">
            <input type="text" class="inline-input suggestion-cat" style="max-width:200px;" value="${s.category}">
            <button class="btn primary suggestion-confirm">Confirm</button>
            <button class="btn suggestion-skip">Skip</button>
          </div>`;
        const input = card.querySelector(".suggestion-cat");
        card.querySelector(".suggestion-confirm").addEventListener("click", async (e) => {
          const category = input.value.trim();
          if (!category) return;
          e.target.disabled = true;
          e.target.textContent = "Saving...";
          const result = await IB_API.call("correct_category", s.label, category);
          if (result.ok) {
            currentData = result.data;
            card.remove();
            renderMerchants();
            if (!list.querySelector(".ai-suggestion")) renderCategorizeCard();
          } else {
            e.target.disabled = false;
            e.target.textContent = "Confirm";
          }
        });
        card.querySelector(".suggestion-skip").addEventListener("click", () => {
          card.remove();
          if (!list.querySelector(".ai-suggestion")) renderCategorizeCard();
        });
        list.appendChild(card);
      });
    }

    async function renderMerchants() {
      const result = await IB_API.call("get_merchants");
      const merchants = result.merchants;
      const host = document.getElementById("ai-merchants-host");
      if (!host) return;

      const pending = window.__ironbudget._pendingMerchFilter;
      if (pending) {
        if (pending.sort_by) IB_VIEW_AI._sortKey = pending.sort_by;
        if (pending.sort_dir) IB_VIEW_AI._sortDir = pending.sort_dir === "asc" ? 1 : -1;
        delete window.__ironbudget._pendingMerchFilter;
      }
      const initialQuery = pending && pending.query ? pending.query : "";

      host.innerHTML = `
        <div class="field" style="max-width:320px;"><input type="text" id="merch-search" placeholder="Search merchant..." value="${initialQuery}"></div>
        <div style="overflow-x:auto;"><table class="data-table" id="merch-table"><thead><tr>
          <th data-key="desc" style="cursor:pointer;">Merchant</th>
          <th class="num" data-key="count" style="cursor:pointer;">Count</th>
          <th class="num" data-key="total" style="cursor:pointer;">Total spent</th>
          <th data-key="category" style="cursor:pointer;">Category</th><th></th>
          </tr></thead><tbody id="merch-tbody"></tbody></table></div>`;

      const searchInput = document.getElementById("merch-search");
      let filtered = merchants;

      const renderRows = () => {
        const q = (searchInput.value || "").toLowerCase();
        filtered = merchants.filter((m) => !q || m.desc.toLowerCase().includes(q) || m.category.toLowerCase().includes(q));
        const key = IB_VIEW_AI._sortKey, dir = IB_VIEW_AI._sortDir;
        filtered = filtered.slice().sort((a, b) => {
          const av = a[key], bv = b[key];
          if (av < bv) return -1 * dir;
          if (av > bv) return 1 * dir;
          return 0;
        });
        const tbody = document.getElementById("merch-tbody");
        let rowsHtml = "";
        filtered.slice(0, 300).forEach((m) => {
          const idx = merchants.indexOf(m);
          rowsHtml += `<tr>
            <td>${m.desc}${m.learned ? ` <span style="color:var(--accent);font-size:10.5px;">(learned)</span>` : ""}</td>
            <td class="num">${m.count}</td>
            <td class="num">${IB_CHARTS.fmtMoney(m.total)}</td>
            <td><input type="text" class="inline-input cat-input" data-idx="${idx}" value="${m.category}"></td>
            <td><button class="btn cat-save" data-idx="${idx}">Save</button></td>
          </tr>`;
        });
        tbody.innerHTML = rowsHtml || `<tr><td colspan="5" style="text-align:center;color:var(--ink-muted);">No matching merchants.</td></tr>`;
        tbody.querySelectorAll(".cat-save").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const idx = parseInt(btn.getAttribute("data-idx"), 10);
            const input = tbody.querySelector(`.cat-input[data-idx="${idx}"]`);
            const category = input.value.trim();
            if (!category) return;
            btn.disabled = true;
            btn.textContent = "Saving...";
            const saveResult = await IB_API.call("correct_category", merchants[idx].desc, category);
            if (saveResult.ok) {
              currentData = saveResult.data;
              renderCurrentView();
            } else {
              btn.disabled = false;
              btn.textContent = "Save";
            }
          });
        });
      };

      searchInput.addEventListener("input", renderRows);
      document.querySelectorAll("#merch-table th[data-key]").forEach((th) => {
        th.addEventListener("click", () => {
          const key = th.getAttribute("data-key");
          if (IB_VIEW_AI._sortKey === key) IB_VIEW_AI._sortDir *= -1;
          else { IB_VIEW_AI._sortKey = key; IB_VIEW_AI._sortDir = key === "desc" ? 1 : -1; }
          renderRows();
        });
      });
      renderRows();
    }
  },
};
