function formatAssistantError(message) {
  const raw = typeof message.errorMessage === "string" ? message.errorMessage.trim() : "";
  if (raw) return raw;
  if (message.stopReason === "error") return "Assistant stopped with an error.";
  return null;
}

module.exports = { formatAssistantError };
