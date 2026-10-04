(() => {
  "use strict";

  const navToggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector("#site-nav");

  navToggle?.addEventListener("click", () => {
    const next = navToggle.getAttribute("aria-expanded") !== "true";
    navToggle.setAttribute("aria-expanded", String(next));
    nav?.classList.toggle("is-open", next);
  });

  nav?.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLAnchorElement)) return;
    nav.classList.remove("is-open");
    navToggle?.setAttribute("aria-expanded", "false");
  });

  const data = Array.isArray(window.MARKET_OPTIONS) ? window.MARKET_OPTIONS : [];
  const results = document.querySelector("#market-results");
  const count = document.querySelector("#market-count");
  const more = document.querySelector("#market-more");
  const search = document.querySelector("#market-search");
  const category = document.querySelector("#market-category");
  const openOnly = document.querySelector("#filter-open");
  const noPhone = document.querySelector("#filter-no-phone");
  const noDebug = document.querySelector("#filter-no-debug");

  if (!results || !count || !more || !search || !category || !openOnly || !noPhone || !noDebug) {
    return;
  }

  const initialLimit = window.matchMedia("(max-width: 1080px)").matches ? 5 : 12;
  let showAll = false;

  const categories = [...new Set(data.map((item) => item.category).filter(Boolean))].sort();
  for (const value of categories) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    category.append(option);
  }

  const boolLabel = (value, yes, no, unknown = "Not stated") => {
    if (value === true) return yes;
    if (value === false) return no;
    return unknown;
  };

  const enumLabel = (value, labels) => labels[value] || "Not clearly disclosed";

  const phoneAppLabel = (value) =>
    enumLabel(value, {
      none: "No phone app",
      required: "Phone app required",
      optional: "Phone app optional",
      "built-in": "Built into phone",
      "device-vendor": "Vendor phone component",
    });

  const debuggingLabel = (value) =>
    enumLabel(value, {
      none: "No debugging",
      required: "USB debugging required",
      optional: "Debugging optional",
    });

  const accountLabel = (value) =>
    enumLabel(value, {
      none: "No account",
      required: "Account required",
      optional: "Account optional",
    });

  const openSourceLabel = (value) =>
    enumLabel(value, {
      yes: "Open source",
      no: "Proprietary",
      "not-disclosed": "Source not disclosed",
    });

  const transportLabel = (item) => {
    if (Array.isArray(item.transport)) return item.transport.join(" + ");
    return item.transport || item.approach;
  };

  const matchesSearch = (item, query) => {
    if (!query) return true;
    return [
      item.name,
      item.category,
      item.approach,
      Array.isArray(item.transport) ? item.transport.join(" ") : item.transport,
      item.status,
      item.summary,
      item.limitations,
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase()
      .includes(query);
  };

  const render = () => {
    const query = search.value.trim().toLocaleLowerCase();
    const filtered = data.filter((item) => {
      if (!matchesSearch(item, query)) return false;
      if (category.value !== "all" && item.category !== category.value) return false;
      if (openOnly.checked && item.openSource !== "yes") return false;
      if (noPhone.checked && item.phoneApp !== "none") return false;
      if (noDebug.checked && item.debugging !== "none") return false;
      return true;
    });

    const hasFilters = Boolean(
      query ||
        category.value !== "all" ||
        openOnly.checked ||
        noPhone.checked ||
        noDebug.checked,
    );
    const visible = showAll || hasFilters ? filtered : filtered.slice(0, initialLimit);

    count.textContent = `${visible.length} of ${data.length} researched options shown`;
    more.hidden = hasFilters || filtered.length <= initialLimit;
    more.textContent = showAll ? "Collapse to overview" : `Show all ${filtered.length} options`;
    results.replaceChildren();

    if (!filtered.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 5;
      cell.className = "empty-results";
      cell.textContent = "No options match those filters. Remove one requirement or try a broader search.";
      row.append(cell);
      results.append(row);
      return;
    }

    for (const item of visible) {
      const row = document.createElement("tr");
      row.dataset.highlight = String(item.id === "aft-macos");

      const product = document.createElement("td");
      product.dataset.label = "Option";
      const link = document.createElement("a");
      link.href = item.sourceUrl;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = item.name;
      product.append(link);
      if (item.status && item.id === "aft-macos") {
        const status = document.createElement("small");
        status.textContent = item.status;
        product.append(status);
      }

      const job = document.createElement("td");
      job.dataset.label = "Job / transport";
      job.textContent = `${item.category} · ${transportLabel(item)}`;
      const jobTag = document.createElement("span");
      jobTag.className = "table-tag";
      jobTag.textContent = boolLabel(item.liveBrowse, "Live browser", "Send / backup", "Varies");
      job.append(jobTag);

      const setup = document.createElement("td");
      setup.dataset.label = "Setup";
      setup.textContent = [
        phoneAppLabel(item.phoneApp),
        debuggingLabel(item.debugging),
        accountLabel(item.account),
      ].join(" · ");

      const source = document.createElement("td");
      source.dataset.label = "Source";
      source.textContent = openSourceLabel(item.openSource);

      const goodAt = document.createElement("td");
      goodAt.dataset.label = "What it is good at";
      goodAt.textContent = item.summary;
      if (item.limitations) {
        const limits = document.createElement("small");
        limits.textContent = `Boundary: ${item.limitations}`;
        goodAt.append(limits);
      }

      row.append(product, job, setup, source, goodAt);
      results.append(row);
    }
  };

  [search, category, openOnly, noPhone, noDebug].forEach((control) => {
    control.addEventListener(control === search ? "input" : "change", render);
  });

  more.addEventListener("click", () => {
    showAll = !showAll;
    render();
    if (!showAll) document.querySelector("#explorer-heading")?.scrollIntoView({ block: "start" });
  });

  render();
})();
