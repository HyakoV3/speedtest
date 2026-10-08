/**
 * Feature switch for choosing the LibreSpeed design (classic, modern or better)
 *
 * This script checks for:
 * 1. URL parameter: ?design=new|modern, ?design=old|classic or ?design=better
 * 2. The design the visitor chose with the design links of the pages, kept in
 *    localStorage["librespeed-design"] (ignored when config.json has "designSwitch": false)
 * 3. Configuration file: config.json with useNewDesign flag
 *
 * Default behavior: Shows the old design
 *
 * Note: This script is only loaded on the root index.html
 */
(function () {
    'use strict';

    // Don't run this script if we're already on a specific design page
    // This prevents infinite redirect loops
    const currentPath = window.location.pathname;
    if (currentPath.includes('index-classic.html') || currentPath.includes('index-modern.html') || currentPath.includes('index-better.html')) {
        return;
    }

    // Check URL parameters first (they override config)
    const urlParams = new URLSearchParams(window.location.search);
    const designParam = urlParams.get('design');

    if (designParam === 'new' || designParam === 'modern') {
        redirectTo('index-modern.html');
        return;
    }

    if (designParam === 'old' || designParam === 'classic') {
        redirectTo('index-classic.html');
        return;
    }

    if (designParam === 'better') {
        redirectTo('index-better.html');
        return;
    }

    // Check config.json for design preference
    try {
        const xhr = new XMLHttpRequest();
        // Use a synchronous request to prevent a flash of the old design before redirecting
        // Bypass stale browser caches so Docker env changes are reflected immediately
        xhr.open('GET', 'config.json?_=' + Date.now(), false);
        xhr.send(null);

        // Check for a successful response, but not 304 Not Modified, which can have an empty response body
        if (xhr.status >= 200 && xhr.status < 300) {
            const config = JSON.parse(xhr.responseText);
            const saved = config.designSwitch !== false ? savedDesign() : null;
            if (saved) {
                redirectTo(pageOf(saved));
            } else if (config.useNewDesign === true) {
                redirectTo('index-modern.html');
            } else {
                redirectTo('index-classic.html');
            }
        } else {
            // Config not found or error - use the saved design, or the old one
            redirectTo(pageOf(savedDesign() || 'classic'));
        }
    } catch (error) {
        // If there's any error (e.g., network, JSON parse), use the saved design, or the old one
        console.log('Using default (old) design:', error.message || 'config error');
        redirectTo(pageOf(savedDesign() || 'classic'));
    }

    // The design the visitor chose with the design links (see design-links.js)
    function savedDesign() {
        try {
            var value = window.localStorage.getItem('librespeed-design');
            return value === 'classic' || value === 'modern' || value === 'better' ? value : null;
        } catch (error) {
            return null;
        }
    }

    function pageOf(design) {
        return 'index-' + design + '.html';
    }

    function redirectTo(page) {
        // Preserve any URL parameters when redirecting
        window.location.href = page + window.location.search;
    }
})();
