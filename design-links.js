/**
 * Design links: the "Design: Classic | Modern | Better" line in the footer of the speed test and stability pages.
 *
 * Without JavaScript they are plain links. With it, a plain click remembers the choice in localStorage
 * ("librespeed-design", read by design-switch.js on index.html) and keeps the query string of the page without design=.
 */
(function () {
  "use strict";

  var KEY = "librespeed-design";
  var DESIGNS = ["classic", "modern", "better"];

  document.addEventListener("click", function (event) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var link = event.target.closest ? event.target.closest("a[data-design]") : null;
    if (!link) return;
    var design = link.getAttribute("data-design");
    if (DESIGNS.indexOf(design) < 0) return;

    event.preventDefault();
    try {
      window.localStorage.setItem(KEY, design);
    } catch (error) {
      // The choice then only applies to this visit
    }
    var params = new URLSearchParams(window.location.search);
    params.delete("design");
    var query = params.toString();
    // The page of each link is its href: the speed test page of the design, or its stability page
    window.location.href = link.getAttribute("href") + (query ? "?" + query : "");
  });
})();
