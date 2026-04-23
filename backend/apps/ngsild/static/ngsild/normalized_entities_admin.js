(function () {
  const root = document.getElementById("ngsild-types-cascade-root");
  if (!root) return;

  const endpoint = root.dataset.endpoint;
  let sources = [];
  try {
    sources = JSON.parse(root.dataset.sources || "[]");
  } catch (_error) {
    sources = [];
  }

  const sourceSelect = document.getElementById("ngsild-source-select");
  const tenantSelect = document.getElementById("ngsild-tenant-select");
  const statusNode = document.getElementById("ngsild-types-status");
  const summaryNode = document.getElementById("ngsild-types-summary");
  const detailsNode = document.getElementById("ngsild-types-details");

  function setStatus(text, isError) {
    statusNode.textContent = text;
    statusNode.style.color = isError ? "#ba2121" : "#666";
  }

  function replaceOptions(select, options, selectedValue) {
    while (select.firstChild) select.removeChild(select.firstChild);
    options.forEach((entry) => {
      const opt = document.createElement("option");
      opt.value = entry.value;
      opt.textContent = entry.label;
      select.appendChild(opt);
    });

    if (selectedValue && options.some((item) => item.value === selectedValue)) {
      select.value = selectedValue;
    }
  }

  function sourceById(sourceId) {
    return sources.find((source) => String(source.id) === String(sourceId));
  }

  function tenantOptionsForSource(source) {
    if (!source) return [{ value: "", label: "Tenant par defaut du source" }];
    const values = source.tenants || [];
    const options = [{ value: "", label: "Tenant par defaut du source" }];
    values.forEach((tenant) => options.push({ value: tenant, label: tenant }));
    return options;
  }

  function renderTypes(payload) {
    const types = Array.isArray(payload.types) ? payload.types : [];
    summaryNode.innerHTML = "";
    detailsNode.innerHTML = "";

    const summary = document.createElement("div");
    summary.style.padding = "8px 10px";
    summary.style.background = "#f7f7f7";
    summary.style.border = "1px solid #ddd";
    summary.style.borderRadius = "6px";
    summary.textContent = `Tenant: ${payload.tenant || "(default source)"} - Types disponibles: ${types.length}`;
    summaryNode.appendChild(summary);

    if (types.length === 0) {
      detailsNode.textContent = "Aucun type retourne par /ngsi-ld/v1/types pour cette combinaison source/tenant.";
      return;
    }

    const container = document.createElement("div");
    container.style.display = "grid";
    container.style.gap = "8px";

    types.forEach((typeEntry) => {
      const block = document.createElement("div");
      block.style.border = "1px solid #ddd";
      block.style.borderRadius = "6px";
      block.style.padding = "8px 10px";
      block.style.background = "#fff";

      const title = document.createElement("div");
      title.style.fontWeight = "700";
      title.textContent = `${typeEntry.type} (${typeEntry.attribute_count} attributs)`;

      const attrs = document.createElement("div");
      attrs.style.marginTop = "6px";
      attrs.style.fontSize = "12px";
      attrs.style.color = "#444";
      attrs.textContent = (typeEntry.attributes || []).join(", ") || "Aucun attribut detaille";

      block.appendChild(title);
      block.appendChild(attrs);
      container.appendChild(block);
    });

    detailsNode.appendChild(container);
  }

  async function loadTypes() {
    const sourceId = sourceSelect.value;
    if (!sourceId) {
      setStatus("Selectionne une source pour charger les types.", false);
      summaryNode.innerHTML = "";
      detailsNode.innerHTML = "";
      return;
    }

    const params = new URLSearchParams({ source_id: sourceId });
    if (tenantSelect.value) {
      params.set("tenant", tenantSelect.value);
    }

    setStatus("Chargement des types...", false);
    try {
      const response = await fetch(`${endpoint}?${params.toString()}`, {
        credentials: "same-origin",
        headers: { "X-Requested-With": "XMLHttpRequest" },
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail || `Erreur ${response.status}`);
      }
      setStatus("Types charges.", false);
      renderTypes(payload);
    } catch (error) {
      setStatus(`Erreur: ${error instanceof Error ? error.message : "chargement impossible"}`, true);
      summaryNode.innerHTML = "";
      detailsNode.innerHTML = "";
    }
  }

  function onSourceChange() {
    const source = sourceById(sourceSelect.value);
    replaceOptions(tenantSelect, tenantOptionsForSource(source), "");
    void loadTypes();
  }

  function initialize() {
    if (sources.length === 0 && sourceSelect.options.length > 1) {
      sources = Array.from(sourceSelect.options)
        .filter((opt) => opt.value)
        .map((opt) => ({ id: opt.value, label: opt.textContent, tenants: [] }));
    }

    if (sourceSelect.options.length <= 1) {
      const sourceOptions = [{ value: "", label: "Selectionner un source" }].concat(
        sources.map((source) => ({ value: String(source.id), label: source.label })),
      );
      replaceOptions(sourceSelect, sourceOptions, "");
    }

    if (tenantSelect.options.length === 0) {
      replaceOptions(tenantSelect, [{ value: "", label: "Tenant par defaut du source" }], "");
    }

    if (sources.length === 0) {
      setStatus("Aucune source disponible. Configure d'abord 'Dashboard NGSI-LD sources'.", true);
    }

    sourceSelect.addEventListener("change", onSourceChange);
    tenantSelect.addEventListener("change", () => {
      void loadTypes();
    });
  }

  initialize();
})();
