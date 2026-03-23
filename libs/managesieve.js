/**
 * ManageSieve Protocol Client (RFC 5804)
 *
 * Implements the ManageSieve protocol for remotely managing Sieve scripts
 * on a mail server. Uses the tcp experiment API for socket access.
 */

"use strict";

// eslint-disable-next-line no-unused-vars
class SieveClient {
  constructor() {
    this.socketId = null;
    this.capabilities = {};
    this.authenticated = false;
  }

  /**
   * Parse server capabilities from greeting or CAPABILITY response lines.
   * Each line is a quoted key optionally followed by a quoted value.
   */
  static parseCapabilities(lines) {
    const caps = {};
    for (const line of lines) {
      const match = line.match(/^"(\w+)"\s*(?:"(.+)")?$/);
      if (match) {
        const key = match[1].toUpperCase();
        const value = match[2] || "";
        caps[key] = value;
      }
    }
    return caps;
  }

  /**
   * Parse a ManageSieve response status line.
   * Returns { status, code, message } where status is "OK", "NO", or "BYE".
   */
  static parseResponseStatus(line) {
    // Match: OK/NO/BYE (response-code) "message"
    const match = line.match(
      /^(OK|NO|BYE)(?:\s+\(([^)]*)\))?(?:\s+"((?:[^"\\]|\\.)*)")?/
    );
    if (!match) {
      return null;
    }
    return {
      status: match[1],
      code: match[2] || null,
      message: match[3] ? match[3].replace(/\\(.)/g, "$1") : null,
    };
  }

  /**
   * Escape a string for use as a ManageSieve quoted string.
   */
  static quoteString(str) {
    return '"' + str.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  }

  /**
   * Encode a string as a ManageSieve literal.
   */
  static literalString(str) {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    return `{${bytes.length}+}\r\n${str}`;
  }

  /**
   * Connect to a ManageSieve server.
   * @param {string} host - Server hostname
   * @param {number} port - Server port (default 4190)
   * @param {object} options - Connection options
   * @returns {object} Server capabilities
   */
  async connect(host, port = 4190, options = {}) {
    this.socketId = await browser.tcp.connect(host, port, {
      timeout: options.timeout || 30,
      useSecureTransport: false,
    });

    // Read the server greeting (capability lines followed by OK)
    const greeting = await this._readResponse();
    this.capabilities = SieveClient.parseCapabilities(greeting.lines);
    return this.capabilities;
  }

  /**
   * Upgrade connection to TLS via STARTTLS.
   * @returns {object} Updated capabilities after TLS negotiation
   */
  async startTLS() {
    if (!this.capabilities.STARTTLS && this.capabilities.STARTTLS !== "") {
      throw new Error("Server does not support STARTTLS");
    }

    await this._sendCommand("STARTTLS");
    const response = await this._readResponse();
    if (response.status !== "OK") {
      throw new Error(
        `STARTTLS failed: ${response.message || response.status}`
      );
    }

    await browser.tcp.startTLS(this.socketId);

    // After STARTTLS, server sends new capabilities
    const capsResponse = await this._readResponse();
    this.capabilities = SieveClient.parseCapabilities(capsResponse.lines);
    return this.capabilities;
  }

  /**
   * Authenticate using SASL PLAIN mechanism.
   * @param {string} username
   * @param {string} password
   */
  async authenticate(username, password) {
    const saslMechanisms = (this.capabilities.SASL || "").split(" ");

    if (saslMechanisms.includes("PLAIN")) {
      await this._authenticatePlain(username, password);
    } else {
      throw new Error(
        `No supported SASL mechanism. Server offers: ${this.capabilities.SASL}`
      );
    }

    this.authenticated = true;
  }

  async _authenticatePlain(username, password) {
    // PLAIN: \0username\0password, base64 encoded
    const authString = `\x00${username}\x00${password}`;
    const encoded = btoa(authString);

    await this._sendCommand(`AUTHENTICATE "PLAIN" "${encoded}"`);
    const response = await this._readResponse();

    if (response.status !== "OK") {
      throw new Error(
        `Authentication failed: ${response.message || response.status}`
      );
    }
  }

  /**
   * List all scripts on the server.
   * @returns {Array<{name: string, active: boolean}>}
   */
  async listScripts() {
    await this._sendCommand("LISTSCRIPTS");
    const response = await this._readResponse();

    if (response.status !== "OK") {
      throw new Error(
        `LISTSCRIPTS failed: ${response.message || response.status}`
      );
    }

    const scripts = [];
    for (const line of response.lines) {
      // Script lines: "scriptname" [ACTIVE]
      const match = line.match(/^"((?:[^"\\]|\\.)*)"(\s+ACTIVE)?$/);
      if (match) {
        scripts.push({
          name: match[1].replace(/\\(.)/g, "$1"),
          active: !!match[2],
        });
      }
    }
    return scripts;
  }

  /**
   * Get the contents of a script.
   * @param {string} name - Script name
   * @returns {string} Script content
   */
  async getScript(name) {
    await this._sendCommand(`GETSCRIPT ${SieveClient.quoteString(name)}`);
    const response = await this._readResponse();

    if (response.status !== "OK") {
      throw new Error(
        `GETSCRIPT failed: ${response.message || response.status}`
      );
    }

    return response.data || "";
  }

  /**
   * Upload or update a script on the server.
   * @param {string} name - Script name
   * @param {string} content - Script content
   */
  async putScript(name, content) {
    const literal = SieveClient.literalString(content);
    await this._sendCommand(
      `PUTSCRIPT ${SieveClient.quoteString(name)} ${literal}`
    );
    const response = await this._readResponse();

    if (response.status !== "OK") {
      throw new Error(
        `PUTSCRIPT failed: ${response.message || response.status}`
      );
    }
  }

  /**
   * Set a script as the active script, or deactivate all scripts.
   * @param {string} name - Script name, or empty string to deactivate all
   */
  async setActive(name) {
    await this._sendCommand(`SETACTIVE ${SieveClient.quoteString(name)}`);
    const response = await this._readResponse();

    if (response.status !== "OK") {
      throw new Error(
        `SETACTIVE failed: ${response.message || response.status}`
      );
    }
  }

  /**
   * Delete a script from the server.
   * @param {string} name - Script name
   */
  async deleteScript(name) {
    await this._sendCommand(
      `DELETESCRIPT ${SieveClient.quoteString(name)}`
    );
    const response = await this._readResponse();

    if (response.status !== "OK") {
      throw new Error(
        `DELETESCRIPT failed: ${response.message || response.status}`
      );
    }
  }

  /**
   * Rename a script on the server.
   * @param {string} oldName
   * @param {string} newName
   */
  async renameScript(oldName, newName) {
    await this._sendCommand(
      `RENAMESCRIPT ${SieveClient.quoteString(oldName)} ${SieveClient.quoteString(newName)}`
    );
    const response = await this._readResponse();

    if (response.status !== "OK") {
      throw new Error(
        `RENAMESCRIPT failed: ${response.message || response.status}`
      );
    }
  }

  /**
   * Check a script for syntax errors without storing it.
   * @param {string} content - Script content
   */
  async checkScript(content) {
    const literal = SieveClient.literalString(content);
    await this._sendCommand(`CHECKSCRIPT ${literal}`);
    const response = await this._readResponse();

    if (response.status !== "OK") {
      throw new Error(
        `Script check failed: ${response.message || response.status}`
      );
    }
  }

  /**
   * Send LOGOUT and close the connection.
   */
  async logout() {
    try {
      await this._sendCommand("LOGOUT");
      await this._readResponse();
    } catch (e) {
      // Ignore errors during logout
    }
    await this.close();
  }

  /**
   * Close the connection without LOGOUT.
   */
  async close() {
    if (this.socketId !== null) {
      try {
        await browser.tcp.close(this.socketId);
      } catch (e) {
        // Already closed
      }
      this.socketId = null;
      this.authenticated = false;
    }
  }

  /**
   * Send a raw command to the server.
   */
  async _sendCommand(command) {
    await browser.tcp.write(this.socketId, command + "\r\n");
  }

  /**
   * Read a complete response from the server.
   * A response consists of zero or more data lines followed by a status line
   * (OK, NO, or BYE). Data may include literal strings {size+}\r\n<data>.
   *
   * Returns { status, code, message, lines, data }
   */
  async _readResponse() {
    const lines = [];
    let data = null;

    while (true) {
      const line = await browser.tcp.readLine(this.socketId);

      // Check if this is a status line
      const status = SieveClient.parseResponseStatus(line);
      if (status) {
        return {
          status: status.status,
          code: status.code,
          message: status.message,
          lines,
          data,
        };
      }

      // Check for literal string: {size+}\r\n followed by <size> bytes
      const literalMatch = line.match(/\{(\d+)\+?\}\s*$/);
      if (literalMatch) {
        const size = parseInt(literalMatch[1], 10);
        const prefix = line.substring(0, literalMatch.index);
        const literalData = await browser.tcp.readBytes(this.socketId, size);

        if (prefix) {
          lines.push(prefix);
        }
        data = literalData;
      } else {
        lines.push(line);
      }
    }
  }
}
