/* Minimal CSInterface — just the handful of calls this panel needs.
   (Drop in Adobe's full CSInterface.js from CEP-Resources if you extend it.) */
function CSInterface() {}
CSInterface.prototype.inHost = function () { return typeof window.__adobe_cep__ !== "undefined"; };
CSInterface.prototype.evalScript = function (script, callback) {
  callback = callback || function () {};
  if (!this.inHost()) { callback("err|This panel only works inside Illustrator."); return; }
  window.__adobe_cep__.evalScript(script, callback);
};
CSInterface.prototype.getExtensionPath = function () {
  return this.inHost() ? window.__adobe_cep__.getSystemPath("extension") : "";
};
CSInterface.prototype.getHostEnvironment = function () {
  try { return JSON.parse(window.__adobe_cep__.getHostEnvironment()); } catch (e) { return null; }
};
CSInterface.prototype.addEventListener = function (type, listener) {
  if (this.inHost()) window.__adobe_cep__.addEventListener(type, listener);
};
