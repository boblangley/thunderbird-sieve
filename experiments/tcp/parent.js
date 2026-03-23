/* eslint-env mozilla-privileged */
/* global ExtensionCommon, Components, ChromeUtils */

"use strict";

var tcp = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    const Cc = Components.classes;
    const Ci = Components.interfaces;
    const Cr = Components.results;

    const stService = Cc["@mozilla.org/network/socket-transport-service;1"]
      .getService(Ci.nsISocketTransportService);
    const tmService = Cc["@mozilla.org/thread-manager;1"]
      .getService(Ci.nsIThreadManager);

    // Open sockets indexed by ID
    const openSockets = new Map();
    let nextSocketId = 0;

    // Clean up on extension shutdown
    context.callOnClose({
      close() {
        for (const [id, sock] of openSockets) {
          try {
            sock.transport.close(Cr.NS_ERROR_ABORT);
          } catch (e) {
            console.error(`[tcp] Error closing socket ${id}:`, e);
          }
        }
        openSockets.clear();
      },
    });

    function getSocket(socketId) {
      const sock = openSockets.get(socketId);
      if (!sock) {
        throw new Error(`Socket ${socketId} not found or already closed`);
      }
      return sock;
    }

    // Wait for data to be available on the input stream
    function waitForData(sock) {
      return new Promise((resolve, reject) => {
        sock.asyncInput.asyncWait(
          {
            QueryInterface: ChromeUtils.generateQI([
              Ci.nsIInputStreamCallback,
            ]),
            onInputStreamReady(stream) {
              try {
                stream.available();
                resolve();
              } catch (e) {
                reject(e);
              }
            },
          },
          0,
          0,
          tmService.mainThreadEventTarget
        );
      });
    }

    return {
      tcp: {
        async _connect(host, port, options = {}) {
          const socketFlags = options.useSecureTransport ? ["starttls"] : [];
          const transport = stService.createTransport(
            socketFlags,
            host,
            port,
            null,
            null
          );

          if (options.timeout) {
            transport.setTimeout(
              Ci.nsISocketTransport.TIMEOUT_READ_WRITE,
              options.timeout
            );
          }
          // Default connect timeout of 30s
          transport.setTimeout(Ci.nsISocketTransport.TIMEOUT_CONNECT, 30);

          const rawInput = transport
            .openInputStream(0, 0, 0)
            .QueryInterface(Ci.nsIAsyncInputStream);
          const scriptableInput = Cc[
            "@mozilla.org/scriptableinputstream;1"
          ].createInstance(Ci.nsIScriptableInputStream);
          scriptableInput.init(rawInput);

          const rawOutput = transport.openOutputStream(
            Ci.nsITransport.OPEN_UNBUFFERED,
            0,
            0
          );

          const socketId = nextSocketId++;
          const sock = {
            transport,
            asyncInput: rawInput,
            scriptableInput,
            rawOutput,
            buffer: "", // Buffered data for line reading
          };
          openSockets.set(socketId, sock);

          // If we requested TLS from the start, upgrade now
          if (options.useSecureTransport) {
            try {
              const tlsControl = transport.tlsSocketControl;
              tlsControl.StartTLS();
            } catch (e) {
              // Some versions use securityInfo
              try {
                const secInfo = transport.securityInfo.QueryInterface(
                  Ci.nsITLSSocketControl
                );
                secInfo.StartTLS();
              } catch (e2) {
                console.warn("[tcp] Could not start immediate TLS:", e2);
              }
            }
          }

          return socketId;
        },

        async _readLine(socketId) {
          const sock = getSocket(socketId);

          while (true) {
            // Check buffer for a complete line
            const crlfIndex = sock.buffer.indexOf("\r\n");
            if (crlfIndex !== -1) {
              const line = sock.buffer.substring(0, crlfIndex);
              sock.buffer = sock.buffer.substring(crlfIndex + 2);
              return line;
            }

            // Wait for more data
            await waitForData(sock);
            const available = sock.scriptableInput.available();
            if (available > 0) {
              sock.buffer += sock.scriptableInput.read(available);
            }
          }
        },

        async _readBytes(socketId, count) {
          const sock = getSocket(socketId);

          while (sock.buffer.length < count) {
            await waitForData(sock);
            const available = sock.scriptableInput.available();
            if (available > 0) {
              sock.buffer += sock.scriptableInput.read(available);
            }
          }

          const data = sock.buffer.substring(0, count);
          sock.buffer = sock.buffer.substring(count);
          return data;
        },

        async _write(socketId, data) {
          const sock = getSocket(socketId);
          const encoder = new TextEncoder();
          const bytes = encoder.encode(data);

          let offset = 0;
          while (offset < bytes.length) {
            const written = sock.rawOutput.write(
              data.substring(offset),
              bytes.length - offset
            );
            offset += written;
          }
        },

        async _startTLS(socketId) {
          const sock = getSocket(socketId);
          try {
            const tlsControl = sock.transport.tlsSocketControl;
            tlsControl.StartTLS();
          } catch (e) {
            try {
              const secInfo = sock.transport.securityInfo.QueryInterface(
                Ci.nsITLSSocketControl
              );
              secInfo.StartTLS();
            } catch (e2) {
              throw new Error("STARTTLS failed: " + e2.message);
            }
          }
        },

        async _close(socketId) {
          const sock = getSocket(socketId);
          openSockets.delete(socketId);
          try {
            sock.transport.close(Cr.NS_OK);
          } catch (e) {
            // Already closed
          }
        },
      },
    };
  }
};
