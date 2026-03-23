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

// ---- Account selector ----

async function loadAccounts() {
  const accounts = await sendMessage({ action: "getAccounts" });

  if (accounts.length === 0) {
    showStatus('No accounts configured. Click the gear icon to add one.');
    return;
  }

  const select = $("#account-select");
  select.textContent = "";
  for (const a of accounts) {
    const opt = document.createElement("option");
    opt.value = a.id;
    opt.textContent = `${a.name} (${a.host})`;
    select.appendChild(opt);
  }

  $("#account-selector").classList.remove("hidden");

  // Restore previously selected account
  const stored = await browser.storage.local.get("lastAccountId");
  const lastId = stored.lastAccountId;
  const restored = accounts.find((a) => a.id === lastId);
  currentAccount = restored || accounts[0];
  select.value = currentAccount.id;

  await loadScripts();

  select.addEventListener("change", async () => {
    currentAccount = accounts.find((a) => a.id === select.value);
    await browser.storage.local.set({ lastAccountId: currentAccount.id });
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
    listEl.textContent = "";
    listEl.classList.remove("hidden");
    $("#actions").classList.remove("hidden");

    if (scripts.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-scripts";
      empty.textContent = "No scripts on server";
      listEl.appendChild(empty);
      return;
    }

    for (const script of scripts) {
      const item = document.createElement("div");
      item.className = "script-item";
      item.setAttribute("role", "button");
      item.setAttribute("tabindex", "0");
      item.setAttribute("aria-label", `Edit script: ${script.name}`);

      const nameSpan = document.createElement("span");
      nameSpan.className = "script-name";
      nameSpan.textContent = script.name;
      item.appendChild(nameSpan);

      if (script.active) {
        const badge = document.createElement("span");
        badge.className = "script-badge";
        badge.textContent = "Active";
        item.appendChild(badge);
      }

      const actions = document.createElement("div");
      actions.className = "script-actions";

      if (!script.active) {
        const activateBtn = document.createElement("button");
        activateBtn.className = "btn-activate";
        activateBtn.title = "Activate";
        activateBtn.setAttribute("aria-label", `Activate ${script.name}`);
        activateBtn.innerHTML = "&#9654;";
        activateBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          try {
            await sendMessage({
              action: "setActive",
              account: currentAccount,
              name: script.name,
            });
            await loadScripts();
          } catch (err) {
            showStatus(`Error: ${err.message}`, true);
          }
        });
        actions.appendChild(activateBtn);
      }

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "btn-delete-script";
      deleteBtn.title = "Delete";
      deleteBtn.setAttribute("aria-label", `Delete ${script.name}`);
      deleteBtn.innerHTML = "&#10005;";
      deleteBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete script "${script.name}"?`)) return;
        try {
          await sendMessage({
            action: "deleteScript",
            account: currentAccount,
            name: script.name,
          });
          await loadScripts();
        } catch (err) {
          showStatus(`Error: ${err.message}`, true);
        }
      });
      actions.appendChild(deleteBtn);

      item.appendChild(actions);

      // Click or keyboard to edit
      const editHandler = (e) => {
        if (e.target.closest(".script-actions")) return;
        openEditor(script.name);
      };
      item.addEventListener("click", editHandler);
      item.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          editHandler(e);
        }
      });

      listEl.appendChild(item);
    }
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
