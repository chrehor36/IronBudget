window.__ironbudget = window.__ironbudget || {};

const IB_VIEWS = [
  IB_VIEW_DASHBOARD, IB_VIEW_MONTHLY, IB_VIEW_CATEGORIES, IB_VIEW_TRENDS,
  IB_VIEW_TRANSFERS, IB_VIEW_RECURRING, IB_VIEW_SAVINGS, IB_VIEW_FUN_MONEY,
  IB_VIEW_TRANSACTIONS, IB_VIEW_AI,
];

let currentData = null;
let currentViewIdx = 0;

function showMessage(title, body) {
  const dlg = document.getElementById("modal-message");
  dlg.innerHTML = `<h3>${title}</h3><p>${body}</p><div class="actions"><button class="btn primary" id="msg-ok">OK</button></div>`;
  dlg.showModal();
  document.getElementById("msg-ok").addEventListener("click", () => dlg.close());
}

const IB_SVG_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
const IB_NAV_ICONS = {
  "Dashboard": IB_SVG_OPEN + '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>',
  "Monthly": IB_SVG_OPEN + '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  "Categories": IB_SVG_OPEN + '<path d="M20.59 13.41L11 3.83V3H3v8h.83l9.58 9.59a2 2 0 0 0 2.83 0l4.35-4.35a2 2 0 0 0 0-2.83z"/><circle cx="6.5" cy="6.5" r="1.2" fill="currentColor"/></svg>',
  "Trends": IB_SVG_OPEN + '<path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/></svg>',
  "Transfers": IB_SVG_OPEN + '<path d="M17 3l4 4-4 4"/><path d="M3 7h18"/><path d="M7 21l-4-4 4-4"/><path d="M21 17H3"/></svg>',
  "Subscriptions": IB_SVG_OPEN + '<path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
  "Savings": IB_SVG_OPEN + '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>',
  "Fun Money": IB_SVG_OPEN + '<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><circle cx="9" cy="9" r="1" fill="currentColor"/><circle cx="15" cy="9" r="1" fill="currentColor"/></svg>',
  "Transactions": IB_SVG_OPEN + '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
  "AI & Categories": IB_SVG_OPEN + '<path d="M12 2l1.8 5.7L19 9.5l-5.2 1.8L12 17l-1.8-5.7L5 9.5l5.2-1.8z"/></svg>',
};

// Plain <div onclick> elements are invisible to screen readers and other
// assistive tech - no role, not keyboard-reachable. Making every clickable
// nav item a real accessible control (tabindex + role="button" + Enter/Space
// support) fixes that for actual screen-reader users, not just automation.
function makeAccessibleClickable(el, onActivate) {
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");
  el.addEventListener("click", onActivate);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onActivate();
    }
  });
}

function renderSidebar(hasTransfers) {
  const nav = document.getElementById("nav-items");
  nav.innerHTML = "";
  IB_VIEWS.forEach((view, i) => {
    if (view === IB_VIEW_TRANSFERS && !hasTransfers) return;
    if (view === IB_VIEW_AI) return; // lives under "Advanced settings & AI" instead
    const item = document.createElement("div");
    item.className = "nav-item" + (i === currentViewIdx ? " active" : "");
    item.title = view.title;
    const icon = IB_NAV_ICONS[view.title] || "";
    item.innerHTML = `<span class="nav-icon">${icon}</span><span class="nav-label">${view.title}</span>`;
    makeAccessibleClickable(item, () => {
      currentViewIdx = i;
      renderCurrentView();
      renderSidebar(hasTransfers);
    });
    nav.appendChild(item);
  });

  const advanced = document.getElementById("nav-advanced");
  if (advanced) {
    advanced.innerHTML = "";
    const aiIdx = IB_VIEWS.indexOf(IB_VIEW_AI);
    const item = document.createElement("div");
    item.className = "nav-item" + (aiIdx === currentViewIdx ? " active" : "");
    item.title = IB_VIEW_AI.title;
    item.innerHTML = `<span class="nav-icon">${IB_NAV_ICONS[IB_VIEW_AI.title] || ""}</span><span class="nav-label">${IB_VIEW_AI.title}</span>`;
    makeAccessibleClickable(item, () => {
      currentViewIdx = aiIdx;
      renderCurrentView();
      renderSidebar(hasTransfers);
    });
    advanced.appendChild(item);
  }
}

function wireSidebarToggle() {
  const toggle = document.getElementById("sidebar-toggle");
  const sidebar = document.getElementById("sidebar");
  if (!toggle || !sidebar || toggle.dataset.wired) return;
  toggle.dataset.wired = "1";
  toggle.addEventListener("click", () => {
    sidebar.classList.toggle("collapsed");
    toggle.title = sidebar.classList.contains("collapsed") ? "Expand sidebar" : "Collapse sidebar";
  });
}

function renderCurrentView() {
  if (!currentData) return;
  const main = document.getElementById("main");
  IB_VIEWS[currentViewIdx].render(main, currentData);
}

function showApp(data, budgetTitle) {
  currentData = data;
  window.__ironbudget.budgetTitle = budgetTitle;
  document.getElementById("brand-sub").textContent = budgetTitle || "";
  document.getElementById("first-run").style.display = "none";
  document.getElementById("app-shell").style.display = "flex";
  document.getElementById("chat-toggle").style.display = "flex";
  wireSidebarToggle();
  renderSidebar(data.agg.has_transfers);
  renderCurrentView();
}

// ---------------- first-run / household form ----------------
function renderPeopleForm(target, initialPeople) {
  const wrap = document.createElement("div");
  wrap.id = "people-fields";
  let people = initialPeople && initialPeople.length ? initialPeople.slice() : [{ first: "", last: "" }];

  function redraw() {
    wrap.innerHTML = "";
    people.forEach((p, i) => {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.gap = "8px";
      row.innerHTML = `
        <div class="field" style="flex:1;"><label>Person ${i + 1} - first name</label><input type="text" data-i="${i}" data-f="first" value="${p.first}"></div>
        <div class="field" style="flex:1;"><label>Person ${i + 1} - last name</label><input type="text" data-i="${i}" data-f="last" value="${p.last}"></div>
      `;
      wrap.appendChild(row);
    });
    wrap.querySelectorAll("input").forEach((inp) => {
      inp.addEventListener("input", () => {
        const i = parseInt(inp.getAttribute("data-i"), 10);
        const f = inp.getAttribute("data-f");
        people[i][f] = inp.value;
      });
    });
  }
  redraw();
  target.appendChild(wrap);

  const addBtn = document.createElement("button");
  addBtn.className = "btn";
  addBtn.textContent = "+ Add person";
  addBtn.style.marginTop = "6px";
  addBtn.addEventListener("click", () => { people.push({ first: "", last: "" }); redraw(); });
  target.appendChild(addBtn);

  return { getPeople: () => people.filter((p) => p.first.trim() || p.last.trim()) };
}

async function runFirstRunFlow() {
  const screen = document.getElementById("first-run");
  const messages = document.getElementById("onboarding-messages");
  const form = document.getElementById("onboarding-form");
  const input = document.getElementById("onboarding-input");
  screen.style.display = "flex";
  // Onboarding is chat-only from the first real reply onward, so warming the
  // model here (rather than waiting for the user to actually type) keeps
  // that first reply fast without paying the cost at every future launch.
  IB_API.call("start_ai_warmup");

  IB_CHAT.addMessage(messages, "assistant", "Hi, I'm Dale! Welcome to IronBudget. Who's this budget for - what's your name?");
  input.focus();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const result = await IB_CHAT.send(messages, input, "onboarding");
    if (!result || !result.ok) return;
    (result.ui_actions || []).forEach((action) => {
      if (action.type === "household_saved") window.__ironbudget.budgetTitle = action.budget_title;
    });
    if (result.data) {
      screen.style.display = "none";
      showApp(result.data, window.__ironbudget.budgetTitle);
    }
  });
}

async function loadAndShow(budgetTitle) {
  const result = await IB_API.call("scan_and_build");
  if (!result.ok) {
    showMessage("Couldn't build your budget", result.error || "Unknown error.");
    return;
  }
  showApp(result.data, budgetTitle);
}

// ---------------- edit household ----------------
async function openEditHousehold() {
  const household = await IB_API.call("get_household");
  const dlg = document.getElementById("modal-household");
  dlg.innerHTML = `<h3>Edit household</h3><div id="household-form-host"></div>
    <div class="actions"><button class="btn" id="hh-cancel">Cancel</button><button class="btn primary" id="hh-save">Save</button></div>`;
  const form = renderPeopleForm(document.getElementById("household-form-host"), household.people || []);
  dlg.showModal();
  document.getElementById("hh-cancel").addEventListener("click", () => dlg.close());
  document.getElementById("hh-save").addEventListener("click", async () => {
    const people = form.getPeople();
    if (!people.length) return;
    const result = await IB_API.call("save_household", people);
    dlg.close();
    document.getElementById("brand-sub").textContent = result.budget_title;
    window.__ironbudget.budgetTitle = result.budget_title;
    if (currentData) { renderCurrentView(); }
  });
}

// AI categorization, model management, and merchant learning all live in the
// dedicated "AI & Categories" view (views/ai_panel.js) instead of a modal.

// ---------------- persistent in-app assistant ----------------
function wireChatPanel() {
  const toggle = document.getElementById("chat-toggle");
  const panel = document.getElementById("chat-panel");
  const closeBtn = document.getElementById("chat-panel-close");
  const messages = document.getElementById("chat-panel-messages");
  const form = document.getElementById("chat-panel-form");
  const input = document.getElementById("chat-panel-input");
  let greeted = false;

  toggle.addEventListener("click", () => {
    panel.classList.toggle("open");
    if (panel.classList.contains("open")) {
      // Model load only ever happens for a session that actually opens
      // chat - the backend no-ops any call after the first, so it's safe
      // to just call this every time the panel opens.
      IB_API.call("start_ai_warmup");
      input.focus();
      if (!greeted) {
        greeted = true;
        IB_CHAT.addMessage(messages, "assistant",
          "Hi, I'm Dale, your IronBudget assistant. Ask me about your numbers, or tell me to categorize things, add files, switch views, or export to Excel.");
      }
    }
  });
  closeBtn.addEventListener("click", () => panel.classList.remove("open"));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const result = await IB_CHAT.send(messages, input, "main");
    if (!result || !result.ok) return;
    if (result.data) currentData = result.data;
    let sidebarChanged = false;
    (result.ui_actions || []).forEach((action) => {
      if (action.type === "navigate" && currentData) {
        const idx = IB_VIEWS.findIndex((v) => v.title === action.view);
        if (idx >= 0) { currentViewIdx = idx; sidebarChanged = true; }
      } else if (action.type === "search_transactions" && currentData) {
        const idx = IB_VIEWS.findIndex((v) => v.title === "Transactions");
        if (idx >= 0) { currentViewIdx = idx; sidebarChanged = true; window.__ironbudget._pendingTxnFilter = action; }
      } else if (action.type === "search_merchants" && currentData) {
        const idx = IB_VIEWS.findIndex((v) => v.title === "AI & Categories");
        if (idx >= 0) { currentViewIdx = idx; sidebarChanged = true; window.__ironbudget._pendingMerchFilter = action; }
      }
    });
    if (sidebarChanged) renderSidebar(currentData.agg.has_transfers);
    if (currentData) renderCurrentView();
  });
}

// ---------------- export ----------------
async function doExport() {
  const household = await IB_API.call("get_household");
  const defaultName = (household.budget_title || "Household Budget") + ".xlsx";
  const result = await IB_API.call("export_excel", defaultName);
  if (result.error) { showMessage("Export failed", result.error); return; }
  if (result.ok) { showMessage("Exported", `Saved to ${result.path}`); }
}

// ---------------- drag & drop visual overlay (cosmetic only - real paths come from Python) ----------------
function wireDropOverlay() {
  const overlay = document.getElementById("drop-overlay");
  let counter = 0;
  window.addEventListener("dragenter", (e) => { e.preventDefault(); counter++; overlay.classList.add("active"); });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("dragleave", () => { counter--; if (counter <= 0) { counter = 0; overlay.classList.remove("active"); } });
  window.addEventListener("drop", (e) => { e.preventDefault(); counter = 0; overlay.classList.remove("active"); });
}

window.__ironbudget.onData = function (result) {
  if (!result.ok) { showMessage("Couldn't add those files", result.error || "Unknown error."); return; }
  currentData = result.data;
  renderSidebar(currentData.agg.has_transfers);
  renderCurrentView();
};

function wireSidebarActions() {
  document.querySelectorAll(".nav-footer .nav-item").forEach((item) => {
    const activate = async () => {
      const action = item.getAttribute("data-action");
      if (action === "edit-household") await openEditHousehold();
      else if (action === "rescan") { const r = await IB_API.call("scan_and_build"); window.__ironbudget.onData(r); }
      else if (action === "add-files") {
        const picked = await IB_API.call("pick_csv_files");
        if (picked.paths && picked.paths.length) {
          const r = await IB_API.call("scan_and_build", picked.paths);
          window.__ironbudget.onData(r);
        }
      } else if (action === "export-excel") await doExport();
    };
    item.addEventListener("click", activate);
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); }
    });
  });
}

// ---------------- first-launch bootstrap (auto-download the embedded AI model) ----------------
// Onboarding itself is a chat conversation, which needs the model downloaded to run at all - on a
// genuinely fresh machine, there'd be nothing to drive that chat yet. So if the model isn't ready,
// download it automatically before onboarding starts, so a brand new user never has to think about it.
function runBootstrap() {
  const screen = document.getElementById("bootstrap-screen");
  const status = document.getElementById("bootstrap-status");
  const bar = document.getElementById("bootstrap-progress-bar");
  screen.style.display = "block";

  return new Promise((resolve) => {
    const baseOnProgress = window.__ironbudget.onAiProgress;
    window.__ironbudget.onAiProgress = function (payload) {
      if (payload.phase === "download") { status.textContent = `Downloading your local AI model... ${payload.pct || 0}%`; bar.style.width = (payload.pct || 0) + "%"; }
      else if (payload.phase === "done") {
        status.textContent = "All set!"; bar.style.width = "100%";
        screen.style.display = "none"; window.__ironbudget.onAiProgress = baseOnProgress; resolve();
      } else if (payload.phase === "error") {
        status.textContent = "Setup hit a snag (" + payload.error + ") - you can download it later from the AI & Categories tab.";
        screen.style.display = "none"; window.__ironbudget.onAiProgress = baseOnProgress; resolve();
      }
    };
    IB_API.call("install_ai_model");
  });
}

async function boot() {
  wireDropOverlay();
  wireSidebarActions();
  wireChatPanel();
  const state = await IB_API.call("get_startup_state");
  if (!state.ai_ready) {
    await runBootstrap();
  }
  if (!state.household) {
    await runFirstRunFlow();
  } else {
    await loadAndShow(state.household.budget_title);
  }
}

boot();
