(function () {
  function modelBasePath() {
    const segments = window.location.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1];

    if (last === "add") {
      segments.pop();
    } else if (last === "change") {
      segments.pop();
      segments.pop();
    }

    return `/${segments.join("/")}/`;
  }

  function joinOptionsUrl() {
    return `${modelBasePath()}join-options/`;
  }

  function setOptions(select, options, selectedValue) {
    if (!select) return;

    const previous = selectedValue || select.value;
    while (select.firstChild) {
      select.removeChild(select.firstChild);
    }

    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "---------";
    select.appendChild(emptyOption);

    options.forEach((option) => {
      const opt = document.createElement("option");
      if (typeof option === "string") {
        opt.value = option;
        opt.textContent = option;
      } else {
        opt.value = option.value;
        opt.textContent = option.label;
      }
      select.appendChild(opt);
    });

    if (previous && Array.from(select.options).some((option) => option.value === previous)) {
      select.value = previous;
    }
  }

  async function fetchOptions(sourceId, tenant, entityType) {
    if (!sourceId) {
      return { tenants: [], entity_types: [], joinable_fields: [] };
    }

    const params = new URLSearchParams({ source_id: sourceId });
    if (tenant) {
      params.set("tenant", tenant);
    }
    if (entityType) {
      params.set("entity_type", entityType);
    }

    const response = await fetch(`${joinOptionsUrl()}?${params.toString()}`, {
      credentials: "same-origin",
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });

    if (!response.ok) {
      throw new Error(`Unable to fetch join options (${response.status})`);
    }

    return response.json();
  }

  function ensureRefreshButton(side) {
    const keyPathSelect = document.getElementById(`id_${side}_key_path`);
    if (!keyPathSelect) return null;

    let button = document.getElementById(`id_${side}_refresh_options`);
    if (button) return button;

    button = document.createElement("button");
    button.type = "button";
    button.id = `id_${side}_refresh_options`;
    button.textContent = "Rafraichir options";
    button.style.marginTop = "6px";
    button.style.padding = "4px 8px";
    button.style.cursor = "pointer";
    keyPathSelect.parentElement.appendChild(button);
    return button;
  }

  async function refreshSide(side) {
    const sourceSelect = document.getElementById(`id_${side}_source`);
    const tenantSelect = document.getElementById(`id_${side}_tenant`);
    const entityTypeSelect = document.getElementById(`id_${side}_entity_type`);
    const keyPathSelect = document.getElementById(`id_${side}_key_path`);
    if (!sourceSelect || !tenantSelect || !entityTypeSelect || !keyPathSelect) return;

    const payload = await fetchOptions(sourceSelect.value, tenantSelect.value || "", entityTypeSelect.value || "");
    setOptions(tenantSelect, payload.tenants || [], tenantSelect.value);
    setOptions(entityTypeSelect, payload.entity_types || [], entityTypeSelect.value);

    const secondPayload = await fetchOptions(sourceSelect.value, tenantSelect.value || "", entityTypeSelect.value || "");
    setOptions(keyPathSelect, secondPayload.joinable_fields || [], keyPathSelect.value);
  }

  async function onSourceChange(side) {
    const sourceSelect = document.getElementById(`id_${side}_source`);
    const tenantSelect = document.getElementById(`id_${side}_tenant`);
    const entityTypeSelect = document.getElementById(`id_${side}_entity_type`);
    const keyPathSelect = document.getElementById(`id_${side}_key_path`);
    if (!sourceSelect || !tenantSelect || !entityTypeSelect || !keyPathSelect) return;

    const payload = await fetchOptions(sourceSelect.value, "", "");
    setOptions(tenantSelect, payload.tenants || [], "");
    setOptions(entityTypeSelect, payload.entity_types || [], "");
    setOptions(keyPathSelect, [], "");
  }

  async function onTenantChange(side) {
    const sourceSelect = document.getElementById(`id_${side}_source`);
    const tenantSelect = document.getElementById(`id_${side}_tenant`);
    const entityTypeSelect = document.getElementById(`id_${side}_entity_type`);
    const keyPathSelect = document.getElementById(`id_${side}_key_path`);
    if (!sourceSelect || !tenantSelect || !entityTypeSelect || !keyPathSelect) return;

    const payload = await fetchOptions(sourceSelect.value, tenantSelect.value || "", "");
    setOptions(entityTypeSelect, payload.entity_types || [], "");
    setOptions(keyPathSelect, [], "");
  }

  async function onEntityTypeChange(side) {
    const sourceSelect = document.getElementById(`id_${side}_source`);
    const tenantSelect = document.getElementById(`id_${side}_tenant`);
    const entityTypeSelect = document.getElementById(`id_${side}_entity_type`);
    const keyPathSelect = document.getElementById(`id_${side}_key_path`);
    if (!sourceSelect || !tenantSelect || !entityTypeSelect || !keyPathSelect) return;

    const payload = await fetchOptions(sourceSelect.value, tenantSelect.value || "", entityTypeSelect.value || "");
    setOptions(keyPathSelect, payload.joinable_fields || [], keyPathSelect.value);
  }

  function wireSide(side) {
    const sourceSelect = document.getElementById(`id_${side}_source`);
    const tenantSelect = document.getElementById(`id_${side}_tenant`);
    const entityTypeSelect = document.getElementById(`id_${side}_entity_type`);
    if (!sourceSelect || !tenantSelect || !entityTypeSelect) return;

    sourceSelect.addEventListener("change", () => {
      void onSourceChange(side);
    });

    tenantSelect.addEventListener("change", () => {
      void onTenantChange(side);
    });

    entityTypeSelect.addEventListener("change", () => {
      void onEntityTypeChange(side);
    });

    const refreshButton = ensureRefreshButton(side);
    if (refreshButton) {
      refreshButton.addEventListener("click", () => {
        void refreshSide(side);
      });
    }

    void refreshSide(side);
  }

  window.addEventListener("load", () => {
    wireSide("left");
    wireSide("right");
  });
})();
