(function () {
  function hasActiveImports() {
    var running = document.querySelectorAll(".ngsild-status-running").length;
    var pending = document.querySelectorAll(".ngsild-status-pending").length;
    return running > 0 || pending > 0;
  }

  if (!hasActiveImports()) {
    return;
  }

  window.setTimeout(function () {
    window.location.reload();
  }, 10000);
})();
