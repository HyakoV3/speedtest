/* exported showSponsor */
/**
 * The sponsor of the selected server, shown under the server list like in the modern design
 * (needs an element with the id "sponsor" and the translations of i18n.js)
 */
function showSponsor(server) {
  var sponsor = I("sponsor");
  sponsor.textContent = "";
  if (!server || !server.sponsorName) return;
  sponsor.appendChild(document.createTextNode(t("classic.sponsor", "Sponsor:") + " "));
  if (/^(https?:)?\/\//i.test(server.sponsorURL || "")) {
    var link = document.createElement("a");
    link.href = server.sponsorURL;
    link.textContent = server.sponsorName;
    sponsor.appendChild(link);
  } else {
    sponsor.appendChild(document.createTextNode(server.sponsorName));
  }
}
