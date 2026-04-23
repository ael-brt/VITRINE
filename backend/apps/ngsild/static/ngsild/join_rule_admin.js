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

  async function fetchOptions(sourceId, entityType) {
    if (!sourceId) {
      return { entity_types: [], joinable_fields: [] };
    }

    const params = new URLSearchParams({ source_id: sourceId });
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

  async function refreshSide(side) {
    const sourceSelect = document.getElementById(`id_${side}_source`);
    const entityTypeSelect = document.getElementById(`id_${side}_entity_type`);
    const keyPathSelect = document.getElementById(`id_${side}_key_path`);
    if (!sourceSelect || !entityTypeSelect || !keyPathSelect) return;

    const payload = await fetchOptions(sourceSelect.value, entityTypeSelect.value || "");
    setOptions(entityTypeSelect, payload.entity_types || [], entityTypeSelect.value);

    const secondPayload = await fetchOptions(sourceSelect.value, entityTypeSelect.value || "");
    setOptions(keyPathSelect, secondPayload.joinable_fields || [], keyPathSelect.value);
  }

  async function onSourceChange(side) {
    const sourceSelect = document.getElementById(`id_${side}_source`);
    const entityTypeSelect = document.getElementById(`id_${side}_entity_type`);
    const keyPathSelect = document.getElementById(`id_${side}_key_path`);
    if (!sourceSelect || !entityTypeSelect || !keyPathSelect) return;

    const payload = await fetchOptions(sourceSelect.value, "");
    setOptions(entityTypeSelect, payload.entity_types || [], "");
    setOptions(keyPathSelect, [], "");

    if (entityTypeSelect.value) {
      const secondPayload = await fetchOptions(sourceSelect.value, entityTypeSelect.value);
      setOptions(keyPathSelect, secondPayload.joinable_fields || [], keyPathSelect.value);
    }
  }

  async function onEntityTypeChange(side) {
    const sourceSelect = document.getElementById(`id_${side}_source`);
    const entityTypeSelect = document.getElementById(`id_${side}_entity_type`);
    const keyPathSelect = document.getElementById(`id_${side}_key_path`);
    if (!sourceSelect || !entityTypeSelect || !keyPathSelect) return;

    const payload = await fetchOptions(sourceSelect.value, entityTypeSelect.value || "");
    setOptions(keyPathSelect, payload.joinable_fields || [], keyPathSelect.value);
  }

  function wireSide(side) {
    const sourceSelect = document.getElementById(`id_${side}_source`);
    const entityTypeSelect = document.getElementById(`id_${side}_entity_type`);
    if (!sourceSelect || !entityTypeSelect) return;

    sourceSelect.addEventListener("change", () => {
      void onSourceChange(side);
    });

    entityTypeSelect.addEventListener("change", () => {
      void onEntityTypeChange(side);
    });

    void refreshSide(side);
  }

  window.addEventListener("load", () => {
    wireSide("left");
    wireSide("right");
  });
})();
