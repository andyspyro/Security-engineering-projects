(() => {
  "use strict";

  const search = document.getElementById("admin-search");

  if (!search) {
    return;
  }

  const rows = Array.from(document.querySelectorAll("[data-admin-row]"));
  const sections = Array.from(document.querySelectorAll("[data-admin-section]"));

  function applyFilter() {
    const term = search.value.trim().toLowerCase();

    rows.forEach((row) => {
      const matches = !term || row.textContent.toLowerCase().includes(term);
      row.hidden = !matches;
    });

    sections.forEach((section) => {
      const sectionRows = Array.from(
        section.querySelectorAll("[data-admin-row]")
      );

      if (!sectionRows.length) {
        return;
      }

      section.hidden = sectionRows.every((row) => row.hidden);
    });
  }

  search.addEventListener("input", applyFilter);
})();
