"use strict";

const $ = (sel) => document.querySelector(sel);

let currentAccount = null;
let originalContent = "";
let isNewScript = false;

async function sendMessage(msg) {
  const result = await browser.runtime.sendMessage(msg);
  if (!result.success) {
    throw new Error(result.error);
  }
  return result.data;
}

function setStatus(text, type = "") {
  const el = $("#status-text");
  el.textContent = text;
  el.className = type;
}

// ---- Line numbers ----

function updateLineNumbers() {
  const editor = $("#editor");
  const lineCount = editor.value.split("\n").length;
  const container = $("#line-numbers");

  let html = "";
  for (let i = 1; i <= lineCount; i++) {
    html += `<span class="line-num">${i}</span>`;
  }
  container.innerHTML = html;
}

function updateCursorPosition() {
  const editor = $("#editor");
  const text = editor.value.substring(0, editor.selectionStart);
  const lines = text.split("\n");
  const line = lines.length;
  const col = lines[lines.length - 1].length + 1;
  $("#status-position").textContent = `Ln ${line}, Col ${col}`;
}

function syncScroll() {
  const editor = $("#editor");
  const lineNumbers = $("#line-numbers");
  lineNumbers.scrollTop = editor.scrollTop;
}

// ---- Load / Save ----

async function init() {
  const params = new URLSearchParams(window.location.search);
  const accountId = params.get("accountId");
  const scriptName = params.get("script");

  // Load the account
  const accounts = await sendMessage({ action: "getAccounts" });
  currentAccount = accounts.find((a) => a.id === accountId);
  if (!currentAccount) {
    setStatus("Account not found", "error");
    return;
  }

  if (scriptName) {
    // Editing existing script
    $("#script-name").value = scriptName;
    setStatus("Loading script...");
    try {
      const content = await sendMessage({
        action: "getScript",
        account: currentAccount,
        name: scriptName,
      });
      $("#editor").value = content;
      originalContent = content;
      updateLineNumbers();
      setStatus("Ready");
    } catch (e) {
      setStatus(`Error loading: ${e.message}`, "error");
    }
  } else {
    // New script
    isNewScript = true;
    $("#script-name").focus();
    setStatus("New script");
  }
}

async function saveScript(activate = false) {
  const name = $("#script-name").value.trim();
  if (!name) {
    setStatus("Please enter a script name", "error");
    $("#script-name").focus();
    return;
  }

  const content = $("#editor").value;
  setStatus("Saving...");

  try {
    await sendMessage({
      action: "putScript",
      account: currentAccount,
      name,
      content,
    });
    originalContent = content;
    isNewScript = false;

    if (activate) {
      await sendMessage({
        action: "setActive",
        account: currentAccount,
        name,
      });
      setStatus("Saved and activated", "success");
    } else {
      setStatus("Saved", "success");
    }
  } catch (e) {
    setStatus(`Save failed: ${e.message}`, "error");
  }
}

async function checkScript() {
  const content = $("#editor").value;
  if (!content.trim()) {
    setStatus("Nothing to check", "error");
    return;
  }

  setStatus("Checking syntax...");
  try {
    await sendMessage({
      action: "checkScript",
      account: currentAccount,
      content,
    });
    setStatus("Syntax OK", "success");
  } catch (e) {
    setStatus(`Syntax error: ${e.message}`, "error");
  }
}

// ---- Tab key support ----

function handleTab(e) {
  if (e.key === "Tab") {
    e.preventDefault();
    const editor = e.target;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.value =
      editor.value.substring(0, start) + "  " + editor.value.substring(end);
    editor.selectionStart = editor.selectionEnd = start + 2;
    updateLineNumbers();
  }
}

// ---- Init ----

document.addEventListener("DOMContentLoaded", () => {
  const editor = $("#editor");

  editor.addEventListener("input", () => {
    updateLineNumbers();
    updateCursorPosition();
  });
  editor.addEventListener("click", updateCursorPosition);
  editor.addEventListener("keyup", updateCursorPosition);
  editor.addEventListener("keydown", handleTab);
  editor.addEventListener("scroll", syncScroll);

  $("#btn-check").addEventListener("click", checkScript);
  $("#btn-save").addEventListener("click", () => saveScript(false));
  $("#btn-save-activate").addEventListener("click", () => saveScript(true));

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      saveScript(false);
    }
  });

  updateLineNumbers();
  init();
});
