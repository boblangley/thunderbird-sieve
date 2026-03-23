"use strict";

const $ = (sel) => document.querySelector(sel);

let currentAccount = null;

async function sendMessage(msg) {
  const result = await browser.runtime.sendMessage(msg);
  if (!result.success) {
    throw new Error(result.error);
  }
  return result.data;
}

function showStatus(text, isError = false) {
  const status = $("#status");
  status.textContent = text;
  status.classList.toggle("error", isError);
  status.classList.remove("hidden");
  $("#script-list").classList.add("hidden");
  $("#actions").classList.add("hidden");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---- Account selector ----

async function loadAccounts() {
  const accounts = await sendMessage({ action: "getAccounts" });

  if (accounts.length === 0) {
    showStatus('No accounts configured. Click the gear icon to add one.');
    return;
  }

  const select = $("#account-select");
  select.innerHTML = accounts
    .map(
      (a) =>
        `<option value="${a.id}">${escapeHtml(a.name)} (${escapeHtml(a.host)})</option>`
    )
    .join("");

  $("#account-selector").classList.remove("hidden");

  // Select first account or previously selected
  currentAccount = accounts[0];
  await loadScripts();

  select.addEventListener("change", async () => {
    currentAccount = accounts.find((a) => a.id === select.value);
    await loadScripts();
  });
}

// ---- Script list ----

async function loadScripts() {
  if (!currentAccount) return;

  showStatus("Connecting...");

  try {
    const scripts = await sendMessage({
      action: "listScripts",
      account: currentAccount,
    });

    $("#status").classList.add("hidden");
    const listEl = $("#script-list");
    listEl.classList.remove("hidden");
    $("#actions").classList.remove("hidden");

    if (scripts.length === 0) {
      listEl.innerHTML =
        '<div class="empty-scripts">No scripts on server</div>';
      return;
    }

    listEl.innerHTML = scripts
      .map(
        (s) => `
      <div class="script-item" data-name="${escapeHtml(s.name)}">
        <span class="script-name">${escapeHtml(s.name)}</span>
        ${s.active ? '<span class="script-badge">Active</span>' : ""}
        <div class="script-actions">
          ${!s.active ? `<button class="btn-activate" title="Activate" data-name="${escapeHtml(s.name)}">&#9654;</button>` : ""}
          <button class="btn-delete-script" title="Delete" data-name="${escapeHtml(s.name)}">&#10005;</button>
        </div>
      </div>
    `
      )
      .join("");

    // Click to edit
    listEl.querySelectorAll(".script-item").forEach((item) => {
      item.addEventListener("click", (e) => {
        if (e.target.closest(".script-actions")) return;
        openEditor(item.dataset.name);
      });
    });

    // Activate button
    listEl.querySelectorAll(".btn-activate").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          await sendMessage({
            action: "setActive",
            account: currentAccount,
            name: btn.dataset.name,
          });
          await loadScripts();
        } catch (err) {
          showStatus(`Error: ${err.message}`, true);
        }
      });
    });

    // Delete button
    listEl.querySelectorAll(".btn-delete-script").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete script "${btn.dataset.name}"?`)) return;
        try {
          await sendMessage({
            action: "deleteScript",
            account: currentAccount,
            name: btn.dataset.name,
          });
          await loadScripts();
        } catch (err) {
          showStatus(`Error: ${err.message}`, true);
        }
      });
    });
  } catch (e) {
    showStatus(`Error: ${e.message}`, true);
    $("#actions").classList.remove("hidden");
  }
}

// ---- Editor ----

function openEditor(scriptName = null) {
  const params = new URLSearchParams();
  params.set("accountId", currentAccount.id);
  if (scriptName) {
    params.set("script", scriptName);
  }
  browser.windows.create({
    url: `../editor/editor.html?${params.toString()}`,
    type: "popup",
    width: 720,
    height: 560,
  });
}

// ---- Init ----

document.addEventListener("DOMContentLoaded", () => {
  loadAccounts();

  $("#btn-settings").addEventListener("click", () => {
    browser.runtime.openOptionsPage();
  });

  $("#btn-new").addEventListener("click", () => {
    if (!currentAccount) return;
    openEditor(null);
  });

  $("#btn-refresh").addEventListener("click", () => loadScripts());
});
