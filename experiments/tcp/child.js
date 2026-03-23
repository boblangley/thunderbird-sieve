/* eslint-env mozilla-privileged */
/* global ExtensionCommon, Cu */

"use strict";

var tcp = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    const callParent = (method, args) =>
      context.childManager.callParentAsyncFunction(method, args);

    return {
      tcp: {
        async connect(host, port, options) {
          return callParent("tcp._connect", [host, port, options || {}]);
        },

        async readLine(socketId) {
          return callParent("tcp._readLine", [socketId]);
        },

        async readBytes(socketId, count) {
          return callParent("tcp._readBytes", [socketId, count]);
        },

        async write(socketId, data) {
          return callParent("tcp._write", [socketId, data]);
        },

        async startTLS(socketId) {
          return callParent("tcp._startTLS", [socketId]);
        },

        async close(socketId) {
          return callParent("tcp._close", [socketId]);
        },
      },
    };
  }
};
