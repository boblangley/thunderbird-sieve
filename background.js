/**
 * Sieve Script Manager - Background Script
 *
 * Manages connections and provides message-based API to the UI.
 */

"use strict";

// Active connections keyed by account config ID
const connections = new Map();

/**
 * Get stored account configurations.
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
  // Reuse existing connection if available
  if (connections.has(account.id)) {
    try {
      // Test the connection with a quick listScripts
      const client = connections.get(account.id);
      if (client.authenticated) {
        return client;
      }
    } catch (e) {
      connections.delete(account.id);
    }
  }

  const client = new SieveClient();

  try {
    await client.connect(account.host, account.port || 4190);

    // Upgrade to TLS if available and not disabled
    if (
      account.security !== "none" &&
      client.capabilities.STARTTLS !== undefined
    ) {
      await client.startTLS();
    }

    await client.authenticate(account.username, account.password);
    connections.set(account.id, client);
    return client;
  } catch (e) {
    await client.close();
    throw e;
  }
}

/**
 * Disconnect from a server.
 */
async function disconnectAccount(accountId) {
  const client = connections.get(accountId);
  if (client) {
    await client.logout();
    connections.delete(accountId);
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
        if (existing >= 0) {
          accounts[existing] = message.account;
        } else {
          accounts.push(message.account);
        }
        await saveAccounts(accounts);
        return { success: true };
      }

      case "deleteAccount": {
        const accounts = await getAccounts();
        await disconnectAccount(message.accountId);
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
          if (
            message.account.security !== "none" &&
            caps.STARTTLS !== undefined
          ) {
            await client.startTLS();
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
      connections.delete(message.account.id);
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
