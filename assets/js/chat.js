// Shared chat bubble rendering + send flow, used by both the onboarding
// screen and the persistent assistant panel.
const IB_CHAT = (() => {
  function addMessage(container, role, text) {
    const div = document.createElement("div");
    div.className = "chat-msg " + role;
    div.textContent = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
  }

  async function send(container, input, phase) {
    const message = input.value.trim();
    if (!message) return null;
    addMessage(container, "user", message);
    input.value = "";
    input.disabled = true;
    let warmingUp = false;
    try {
      const status = await IB_API.call("is_ai_warming_up");
      warmingUp = !!(status && status.warming_up);
    } catch (e) { /* ignore - just falls back to the normal "Thinking..." text */ }
    const thinking = addMessage(container, "assistant thinking",
      warmingUp ? "Getting your AI ready - this happens once, please wait..." : "Thinking...");
    let result;
    try {
      result = await IB_API.call("assistant_send", message, phase);
    } finally {
      thinking.remove();
      input.disabled = false;
      input.focus();
    }
    if (!result.ok) {
      addMessage(container, "assistant", "Sorry, something went wrong: " + (result.error || "unknown error"));
      return result;
    }
    addMessage(container, "assistant", result.reply || "...");
    return result;
  }

  return { addMessage, send };
})();
