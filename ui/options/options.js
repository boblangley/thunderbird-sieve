"use strict";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

async function sendMessage(msg) {
  const result = await browser.runtime.sendMessage(msg);
  if (!result.success) {
    throw new Error(result.error);
  }
  return result.data;
}

// ---- Account list rendering ----

async function renderAccountList() {
  const accounts = await sendMessage({ action: "getAccounts" });
  const container = $("#account-list");

  if (accounts.length === 0) {
    container.innerHTML =
      '<div class="empty-state">No accounts configured. Click "Add Account" to get started.</div>';
    return;
  }

  container.innerHTML = accounts
    .map(
      (account) => `
    <div class="account-card" data-id="${account.id}">
      <div class="account-info">
        <div class="account-name">${escapeHtml(account.name)}</div>
        <div class="account-server">${escapeHtml(account.host)}:${account.port || 4190}</div>
      </div>
      <div class="account-actions">
        <button class="btn btn-sm btn-edit" data-id="${account.id}">Edit</button>
        <button class="btn btn-sm btn-danger btn-delete" data-id="${account.id}">Delete</button>
      </div>
    </div>
  `
    )
    .join("");

  // Bind edit/delete buttons
  container.querySelectorAll(".btn-edit").forEach((btn) => {
    btn.addEventListener("click", () => editAccount(btn.dataset.id));
  });
  container.querySelectorAll(".btn-delete").forEach((btn) => {
    btn.addEventListener("click", () => deleteAccount(btn.dataset.id));
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---- Form handling ----

function showForm(account = null) {
  const form = $("#account-form");
  form.classList.remove("hidden");
  $("#form-title").textContent = account ? "Edit Account" : "Add Account";
  $("#test-result").classList.add("hidden");

  if (account) {
    $("#account-id").value = account.id;
    $("#account-name").value = account.name;
    $("#account-host").value = account.host;
    $("#account-port").value = account.port || 4190;
    $("#account-security").value = account.security || "starttls";
    $("#account-username").value = account.username;
    $("#account-password").value = account.password;
  } else {
    $("#account-id").value = "";
    $("#account-name").value = "";
    $("#account-host").value = "";
    $("#account-port").value = "4190";
    $("#account-security").value = "starttls";
    $("#account-username").value = "";
    $("#account-password").value = "";
  }

  $("#account-name").focus();
}

function hideForm() {
  $("#account-form").classList.add("hidden");
}

function getFormData() {
  return {
    id: $("#account-id").value || `acct_${Date.now()}`,
    name: $("#account-name").value.trim(),
    host: $("#account-host").value.trim(),
    port: parseInt($("#account-port").value, 10) || 4190,
    security: $("#account-security").value,
    username: $("#account-username").value.trim(),
    password: $("#account-password").value,
  };
}

async function editAccount(id) {
  const accounts = await sendMessage({ action: "getAccounts" });
  const account = accounts.find((a) => a.id === id);
  if (account) {
    showForm(account);
  }
}

async function deleteAccount(id) {
  if (!confirm("Delete this account configuration?")) {
    return;
  }
  await sendMessage({ action: "deleteAccount", accountId: id });
  await renderAccountList();
}

// ---- Test connection ----

async function testConnection() {
  const testResult = $("#test-result");
  testResult.classList.remove("hidden", "success", "error");
  testResult.textContent = "Testing connection...";

  const account = getFormData();
  if (!account.host || !account.username || !account.password) {
    testResult.classList.add("error");
    testResult.textContent = "Please fill in host, username, and password.";
    return;
  }

  const result = await browser.runtime.sendMessage({
    action: "testConnection",
    account,
  });

  if (result.success) {
    testResult.classList.add("success");
    const caps = result.data;
    testResult.textContent = `Connection successful! Server: ${caps.IMPLEMENTATION || "Unknown"}. Sieve extensions: ${caps.SIEVE || "N/A"}`;
  } else {
    testResult.classList.add("error");
    testResult.textContent = `Connection failed: ${result.error}`;
  }
}

// ---- Init ----

document.addEventListener("DOMContentLoaded", () => {
  renderAccountList();

  $("#btn-add").addEventListener("click", () => showForm());
  $("#btn-cancel").addEventListener("click", () => hideForm());
  $("#btn-test").addEventListener("click", () => testConnection());

  $("#btn-save").addEventListener("click", async () => {
    const account = getFormData();
    if (!account.name || !account.host || !account.username) {
      alert("Please fill in the required fields: name, host, and username.");
      return;
    }
    await sendMessage({ action: "saveAccount", account });
    hideForm();
    await renderAccountList();
  });
});
