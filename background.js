/**
 * Sieve Script Manager - Background Script
 *
 * Manages connections and provides message-based API to the UI.
 */

"use strict";

// Active connections keyed by a fingerprint of account settings
const connections = new Map();

/**
 * Build a fingerprint for connection caching that includes server details,
 * so edits to an account invalidate stale connections.
 */
function connectionKey(account) {
  return `${account.id}|${account.host}|${account.port || 4190}|${account.username}|${account.security || "starttls"}`;
}

/**
 * Get stored account configurations.
 * Note: Passwords are stored in browser.storage.local. For production use,
 * consider integrating with Thunderbird's Login Manager for secure credential
 * storage.
 */
async function getAccounts() {
  const result = await browser.storage.local.get("accounts");
  return result.accounts || [];
}

/**
 * Save account configurations.
 */
async function saveAccounts(accounts) {
  await browser.storage.local.set({ accounts });
}

/**
 * Connect to a ManageSieve server for a given account config.
 */
async function connectAccount(account) {
  const key = connectionKey(account);

  // Reuse existing connection if available and healthy
  if (connections.has(key)) {
    const client = connections.get(key);
    if (client.authenticated) {
      try {
        // Validate the connection is still alive with a lightweight command
        await client.listScripts();
        return client;
      } catch (e) {
        // Connection is dead, clean up and reconnect
        connections.delete(key);
        await client.close().catch(() => {});
      }
    }
  }

  const client = new SieveClient();

  try {
    await client.connect(account.host, account.port || 4190);

    // Upgrade to TLS if not explicitly disabled
    if (account.security !== "none") {
      if (client.capabilities.STARTTLS !== undefined) {
        await client.startTLS();
      } else {
        // STARTTLS expected but not offered — refuse to send credentials
        // in cleartext to prevent downgrade attacks
        throw new Error(
          "Server does not offer STARTTLS. Refusing to authenticate over " +
            "an unencrypted connection. Set security to 'None' if you " +
            "intentionally want plaintext."
        );
      }
    }

    await client.authenticate(account.username, account.password);
    connections.set(key, client);
    return client;
  } catch (e) {
    await client.close();
    throw e;
  }
}

/**
 * Disconnect from a server.
 */
async function disconnectAccount(account) {
  const key = typeof account === "string" ? account : connectionKey(account);
  // Try to find by key or by account ID prefix
  for (const [k, client] of connections) {
    if (k === key || k.startsWith(account + "|")) {
      await client.logout().catch(() => {});
      connections.delete(k);
    }
  }
}

/**
 * Message handler for UI communication.
 */
browser.runtime.onMessage.addListener(async (message) => {
  try {
    switch (message.action) {
      // Account management
      case "getAccounts":
        return { success: true, data: await getAccounts() };

      case "saveAccount": {
        const accounts = await getAccounts();
        const existing = accounts.findIndex((a) => a.id === message.account.id);
        // Invalidate any cached connection for this account on edit
        if (existing >= 0) {
          const oldKey = connectionKey(accounts[existing]);
          const oldClient = connections.get(oldKey);
          if (oldClient) {
            connections.delete(oldKey);
            oldClient.close().catch(() => {});
          }
          accounts[existing] = message.account;
        } else {
          accounts.push(message.account);
        }
        await saveAccounts(accounts);
        return { success: true };
      }

      case "deleteAccount": {
        const accounts = await getAccounts();
        await disconnectAccount(message.accountId || message.account?.id);
        await saveAccounts(accounts.filter((a) => a.id !== message.accountId));
        return { success: true };
      }

      case "testConnection": {
        const client = new SieveClient();
        try {
          const caps = await client.connect(
            message.account.host,
            message.account.port || 4190
          );
          if (message.account.security !== "none") {
            if (caps.STARTTLS !== undefined) {
              await client.startTLS();
            } else {
              throw new Error(
                "Server does not offer STARTTLS. Refusing to authenticate " +
                  "over an unencrypted connection."
              );
            }
          }
          await client.authenticate(
            message.account.username,
            message.account.password
          );
          await client.logout();
          return { success: true, data: caps };
        } catch (e) {
          await client.close();
          return { success: false, error: e.message };
        }
      }

      // Script operations
      case "listScripts": {
        const client = await connectAccount(message.account);
        const scripts = await client.listScripts();
        return { success: true, data: scripts };
      }

      case "getScript": {
        const client = await connectAccount(message.account);
        const content = await client.getScript(message.name);
        return { success: true, data: content };
      }

      case "putScript": {
        const client = await connectAccount(message.account);
        await client.putScript(message.name, message.content);
        return { success: true };
      }

      case "setActive": {
        const client = await connectAccount(message.account);
        await client.setActive(message.name);
        return { success: true };
      }

      case "deleteScript": {
        const client = await connectAccount(message.account);
        await client.deleteScript(message.name);
        return { success: true };
      }

      case "renameScript": {
        const client = await connectAccount(message.account);
        await client.renameScript(message.oldName, message.newName);
        return { success: true };
      }

      case "checkScript": {
        const client = await connectAccount(message.account);
        await client.checkScript(message.content);
        return { success: true };
      }

      default:
        return { success: false, error: `Unknown action: ${message.action}` };
    }
  } catch (e) {
    console.error(`[SieveManager] Error handling ${message.action}:`, e);
    // If the connection died, remove it so next attempt reconnects
    if (message.account?.id) {
      const key = connectionKey(message.account);
      const deadClient = connections.get(key);
      if (deadClient) {
        connections.delete(key);
        deadClient.close().catch(() => {});
      }
    }
    return { success: false, error: e.message };
  }
});

// Clean up connections on shutdown
browser.runtime.onSuspend?.addListener?.(() => {
  for (const [, client] of connections) {
    client.close().catch(() => {});
  }
  connections.clear();
});
