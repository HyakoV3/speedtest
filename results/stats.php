<?php
// The session cookie of the admin: kept away from scripts, and from other sites. Behind a proxy that ends the
// HTTPS (Traefik, nginx) PHP only sees HTTP, so the header of the proxy tells whether the visitor used HTTPS.
$statsHttps = !empty($_SERVER['HTTPS']) || 'https' === strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''));
session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'secure' => $statsHttps || (bool) ini_get('session.cookie_secure'),
    'httponly' => true,
    'samesite' => 'Strict',
]);
// Only ids the server made are accepted
ini_set('session.use_strict_mode', '1');
session_start();
error_reporting(0);

require 'telemetry_settings.php';
require_once 'telemetry_db.php';
require_once 'stats_summary.php';

// The login is handled here, before the page starts, because a new session id needs a header. The new id is why an id
// known before the login is of no use afterwards.
if (
    isset($stats_password) && 'PASSWORD' !== $stats_password && true !== ($_SESSION['logged'] ?? false)
    && 'login' === ($_GET['op'] ?? '') && is_string($_POST['password'] ?? null)
    && hash_equals((string) $stats_password, $_POST['password'])
) {
    session_regenerate_id(true);
    $_SESSION['logged'] = true;
    header('Location: stats.php', true, 303);
    exit;
}

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0, s-maxage=0');
header('Cache-Control: post-check=0, pre-check=0', false);
header('Pragma: no-cache');
?>
<!DOCTYPE html>
<html lang="en">
    <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>LibreSpeed - Stats</title>
        <link rel="shortcut icon" href="../frontend/images/favicon.svg" />
        <!-- The theme, the colors and the high contrast of the better pages, when frontend/ sits next to results/.
             Without it the fallbacks in the style below give a light page. The order is the one of the better pages. -->
        <script src="../frontend/better/javascript/theme.js"></script>
        <script src="../frontend/better/javascript/accessibility.js"></script>
        <link rel="stylesheet" href="../frontend/better/styling/tokens.css" />
        <link rel="stylesheet" href="../frontend/better/styling/contrast.css" />
        <style type="text/css">
            /* Base: the font and the colors of the better pages */
            *, *::before, *::after{
                box-sizing:border-box;
            }
            html{
                background:var(--bg, #fbfcfe);
                color:var(--text, #1f2430);
                font-family:Arial, sans-serif;
            }
            body{
                margin:0;
                padding:1.5rem 1rem 3rem;
                line-height:1.45;
            }
            a{
                color:var(--primary, #2563eb);
            }
            :focus-visible{
                outline:0.125rem solid var(--primary, #2563eb);
                outline-offset:0.125rem;
            }
            h1, h2, h3, p, dl, dd{
                margin:0;
            }
            .page{
                max-width:72rem;
                margin:0 auto;
            }
            .muted{
                color:var(--muted, #667085);
            }
            .sr-only{
                position:absolute;
                width:1px;
                height:1px;
                overflow:hidden;
                clip:rect(0 0 0 0);
                white-space:nowrap;
            }

            /* Controls: filled for the action of a form, outlined for the others, as in the better pages */
            input, select{
                font:inherit;
                color:var(--text, #1f2430);
                background:var(--surface-muted, #f3f5f9);
                border:1px solid var(--border, #d9dde5);
                border-radius:var(--radius-button, 0.75rem);
                padding:0.4em 0.8em;
                min-height:2.4rem;
            }
            input[type="submit"], .btn{
                display:inline-flex;
                align-items:center;
                color:var(--primary, #2563eb);
                background:none;
                border:0.1em solid var(--primary, #2563eb);
                text-decoration:none;
                cursor:pointer;
            }
            input[type="submit"].main{
                color:var(--on-primary, #ffffff);
                background:var(--primary, #2563eb);
            }
            input[type="submit"]:hover, .btn:hover{
                color:var(--on-primary, #ffffff);
                background:var(--primary, #2563eb);
            }
            .btn{
                min-height:2.4rem;
                padding:0.3em 0.9em;
                border-radius:var(--radius-button, 0.75rem);
            }
            .btn.off{
                color:var(--muted, #667085);
                border-color:var(--border, #d9dde5);
                background:none;
                opacity:0.55;
                cursor:default;
            }

            /* The top of the page */
            .top{
                display:flex;
                flex-wrap:wrap;
                align-items:flex-start;
                justify-content:space-between;
                gap:0.75rem 1rem;
                margin-bottom:2rem;
            }
            h1{
                font-size:1.7rem;
                line-height:1.2;
            }
            .top form{
                margin:0;
            }
            section{
                margin-bottom:2.5rem;
            }
            .head{
                display:flex;
                flex-wrap:wrap;
                align-items:center;
                justify-content:space-between;
                gap:0.75rem 1rem;
                margin-bottom:1rem;
            }
            h2{
                font-size:1.2rem;
            }
            .tools{
                display:flex;
                flex-wrap:wrap;
                align-items:center;
                gap:0.5rem 1rem;
            }
            .tools form{
                display:flex;
                align-items:center;
                gap:0.5rem;
                margin:0;
            }
            .month{
                display:flex;
                flex-wrap:nowrap;
                align-items:center;
                gap:0.5rem;
            }
            .month form{
                display:flex;
                align-items:center;
                gap:0.5rem;
                margin:0;
                flex:1 1 auto;
            }
            .month input[type="month"]{
                flex:1 1 8rem;
                min-width:0;
            }

            /* The summary of the month: the total, then one tile for each measurement */
            .total{
                margin-bottom:1rem;
                color:var(--muted, #667085);
            }
            .total strong{
                margin-right:0.25em;
                font-size:2.2rem;
                line-height:1;
                color:var(--text, #1f2430);
                font-variant-numeric:tabular-nums;
            }
            .metrics{
                display:grid;
                grid-template-columns:repeat(2, 1fr);
                gap:0.75rem;
            }
            @media (min-width:64em){
                .metrics{
                    grid-template-columns:repeat(4, 1fr);
                }
            }
            .metric{
                --c:var(--primary, #2563eb);
                padding:1rem;
                background:var(--surface, #ffffff);
                border:1px solid var(--border, #d9dde5);
                border-radius:var(--radius-card, 1rem);
            }
            .metric.ul{
                --c:var(--secondary, #0d9488);
            }
            .metric.ping, .metric.jitter{
                --c:var(--muted, #667085);
            }
            .metric h3{
                font-size:0.8rem;
                font-weight:600;
                letter-spacing:0.05em;
                text-transform:uppercase;
                color:var(--muted, #667085);
            }
            .median{
                margin-top:0.35rem;
                font-size:2.1rem;
                font-weight:700;
                line-height:1.1;
                font-variant-numeric:tabular-nums;
            }
            .median .unit{
                font-size:0.95rem;
                font-weight:400;
                color:var(--muted, #667085);
            }
            .median .what{
                display:block;
                font-size:0.78rem;
                font-weight:400;
                color:var(--muted, #667085);
            }
            .bar{
                position:relative;
                height:0.55rem;
                margin:0.9rem 0 0.4rem;
                background:var(--meter-track, #80808040);
                border-radius:999px;
            }
            .bar span{
                position:absolute;
                top:0;
                bottom:0;
                background:var(--c);
                border-radius:999px;
                opacity:0.65;
            }
            .bar i{
                position:absolute;
                top:-0.2rem;
                bottom:-0.2rem;
                width:3px;
                margin-left:-1px;
                background:var(--text, #1f2430);
                border-radius:2px;
            }
            .range{
                display:flex;
                justify-content:space-between;
                gap:0.5rem;
                font-size:0.85rem;
                font-variant-numeric:tabular-nums;
            }
            .range div{
                display:flex;
                flex-direction:column;
            }
            .range div:last-child{
                align-items:flex-end;
            }
            .range dt{
                font-size:0.72rem;
                color:var(--muted, #667085);
            }
            .metric .valid{
                margin-top:0.6rem;
                font-size:0.78rem;
                color:var(--muted, #667085);
            }
            .metric .few{
                color:var(--poor, #e67e22);
            }
            .empty, .notice{
                padding:1rem;
                border:1px dashed var(--border, #d9dde5);
                border-radius:var(--radius-card, 1rem);
                color:var(--muted, #667085);
            }
            .notice.error{
                color:var(--text, #1f2430);
                border:1px solid var(--bad, #e74c3c);
            }

            /* The list of tests: a table that becomes a stack of cards on a narrow screen */
            .scroll{
                overflow-x:auto;
                border:1px solid var(--border, #d9dde5);
                border-radius:var(--radius-card, 1rem);
                background:var(--surface, #ffffff);
            }
            table.tests{
                width:100%;
                border-collapse:collapse;
            }
            .tests th{
                padding:0.6rem 0.75rem;
                font-size:0.74rem;
                font-weight:600;
                letter-spacing:0.05em;
                text-align:left;
                text-transform:uppercase;
                color:var(--muted, #667085);
                background:var(--surface-muted, #f3f5f9);
                border-bottom:1px solid var(--border, #d9dde5);
            }
            .tests td{
                padding:0.65rem 0.75rem;
                vertical-align:top;
                border-bottom:1px solid var(--border, #d9dde5);
            }
            .tests tr:last-child td{
                border-bottom:0;
            }
            .tests tbody tr:hover td{
                background:var(--surface-muted, #f3f5f9);
            }
            .tests .num{
                text-align:right;
                white-space:nowrap;
                font-variant-numeric:tabular-nums;
            }
            .tests th.num{
                text-align:right;
            }
            .tests .when{
                white-space:nowrap;
            }
            .tests .when a{
                display:block;
                font-size:0.82rem;
            }
            .tests .net span, .tests .ua{
                color:var(--muted, #667085);
                font-size:0.85rem;
            }
            .tests .net span{
                display:block;
            }
            .tests .ua{
                min-width:12rem;
                max-width:20rem;
                overflow-wrap:anywhere;
            }
            .pager{
                display:flex;
                flex-wrap:wrap;
                align-items:center;
                gap:0.5rem;
                margin:1rem 0 0;
            }
            .pager > a, .pager > .off{
                display:inline-flex;
                padding:0.3em 0.9em;
                color:var(--primary, #2563eb);
                text-decoration:none;
                border:1px solid var(--border, #d9dde5);
                border-radius:var(--radius-button, 0.75rem);
            }
            .pager > a:hover{
                color:var(--on-primary, #ffffff);
                background:var(--primary, #2563eb);
            }
            .pager > .off{
                color:var(--muted, #667085);
                opacity:0.55;
            }
            .pager > span[aria-current]{
                margin:0 0.5rem;
                color:var(--muted, #667085);
                opacity:1;
                border:0;
                padding:0;
            }

            /* One test */
            .detail{
                display:grid;
                grid-template-columns:repeat(auto-fit, minmax(14rem, 1fr));
                gap:1rem 1.5rem;
                padding:1.25rem;
                background:var(--surface, #ffffff);
                border:1px solid var(--border, #d9dde5);
                border-radius:var(--radius-card, 1rem);
            }
            .detail dt{
                font-size:0.74rem;
                font-weight:600;
                letter-spacing:0.05em;
                text-transform:uppercase;
                color:var(--muted, #667085);
            }
            .detail dd{
                margin-top:0.15rem;
                overflow-wrap:anywhere;
                font-variant-numeric:tabular-nums;
            }
            .detail .unit{
                color:var(--muted, #667085);
            }
            details{
                margin-top:1rem;
            }
            summary{
                cursor:pointer;
                color:var(--primary, #2563eb);
            }
            pre{
                margin:0.5rem 0 0;
                padding:0.75rem;
                max-height:24rem;
                overflow:auto;
                font-size:0.8rem;
                white-space:pre-wrap;
                overflow-wrap:anywhere;
                background:var(--surface-muted, #f3f5f9);
                border:1px solid var(--border, #d9dde5);
                border-radius:var(--radius-button, 0.75rem);
            }

            /* The login */
            .login{
                max-width:22rem;
                margin:12vh auto 0;
            }
            .login form{
                display:flex;
                flex-direction:column;
                gap:0.75rem;
                margin-top:1.25rem;
            }

            @media (max-width:60em){
                .scroll{
                    border:0;
                    background:none;
                }
                table.tests, .tests tbody, .tests tr, .tests td{
                    display:block;
                }
                .tests thead{
                    position:absolute;
                    width:1px;
                    height:1px;
                    overflow:hidden;
                    clip:rect(0 0 0 0);
                }
                .tests tr{
                    display:grid;
                    grid-template-columns:1fr 1fr;
                    margin-bottom:0.75rem;
                    padding:0.4rem 0.25rem;
                    background:var(--surface, #ffffff);
                    border:1px solid var(--border, #d9dde5);
                    border-radius:var(--radius-card, 1rem);
                }
                .tests td, .tests tr:last-child td{
                    display:flex;
                    justify-content:space-between;
                    gap:1rem;
                    padding:0.25rem 0.75rem;
                    border:0;
                }
                .tests td::before{
                    content:attr(data-label);
                    flex:none;
                    color:var(--muted, #667085);
                    font-size:0.8rem;
                }
                .tests td.when, .tests td.net, .tests td.ua{
                    grid-column:1 / -1;
                }
                .tests td.when{
                    display:block;
                    padding-top:0.5rem;
                    font-weight:700;
                }
                .tests td.when::before, .tests td.ua::before{
                    display:none;
                }
                .tests td.net{
                    flex-wrap:wrap;
                }
                .tests td.ua{
                    min-width:0;
                    max-width:none;
                }
                .tests tbody tr:hover td{
                    background:none;
                }
            }
            @media (max-width:48em){
                body{
                    padding:1rem 0.75rem 2rem;
                }
                .month{
                    flex-wrap:wrap;
                }
                .metrics{
                    gap:0.5rem;
                }
                .metric{
                    padding:0.75rem;
                }
                .median{
                    font-size:1.7rem;
                }
            }
        </style>
    </head>
    <body>
        <div class="page">
        <?php
        if (!isset($stats_password) || $stats_password === 'PASSWORD') {
            ?>
            <header class="top"><div><h1>LibreSpeed Stats</h1></div></header>
            <p class="notice">Please set $stats_password in telemetry_settings.php to enable access.</p>
            <?php
        } elseif ($_SESSION['logged'] === true) {
            if ($_GET['op'] === 'logout') {
                $_SESSION['logged'] = false;
                ?><script type="text/javascript">window.location=location.protocol+"//"+location.host+location.pathname;</script><?php
            } else {
                ?>
                <header class="top">
                    <div>
                        <h1>Statistics</h1>
                        <p class="muted">The tests stored by this server</p>
                    </div>
                    <form action="stats.php" method="GET"><input type="hidden" name="op" value="logout" /><input type="submit" value="Log out" /></form>
                </header>
                <main>
                <?php
                $statsPer = statsPerPage($_GET['per'] ?? null);
                // The summary of a month, unless one test was asked for
                if ('id' !== ($_GET['op'] ?? '') || empty($_GET['id'])) {
                    $statsMonth = statsMonth($_GET['month'] ?? null);
                    list($statsFrom, $statsTo) = statsMonthBounds($statsMonth, $db_type);
                    $statsRows = getSpeedtestValuesBetween($statsFrom, $statsTo);
                    $statsMonthEsc = htmlspecialchars($statsMonth, ENT_QUOTES | ENT_HTML5, 'UTF-8');
                    $statsLabel = htmlspecialchars(statsMonthLabel($statsMonth), ENT_HTML5, 'UTF-8');
                    $statsPrev = statsMonthShift($statsMonth, -1);
                    $statsNext = statsMonthShift($statsMonth, 1);
                    ?>
                    <section aria-labelledby="summary-title">
                        <div class="head">
                            <h2 id="summary-title">Monthly summary</h2>
                            <div class="month">
                                <a class="btn" href="stats.php?<?= htmlspecialchars(http_build_query(['month' => $statsPrev, 'per' => $statsPer]), ENT_QUOTES | ENT_HTML5, 'UTF-8') ?>" aria-label="Previous month, <?= htmlspecialchars(statsMonthLabel($statsPrev), ENT_QUOTES | ENT_HTML5, 'UTF-8') ?>">&larr;</a>
                                <form action="stats.php" method="GET">
                                    <input type="hidden" name="per" value="<?= (int) $statsPer ?>" />
                                    <label class="sr-only" for="month">Month</label>
                                    <input type="month" name="month" id="month" value="<?= $statsMonthEsc ?>" placeholder="YYYY-MM" />
                                    <input type="submit" class="main" value="Show" />
                                </form>
                                <?php if ($statsNext <= gmdate('Y-m')) { ?>
                                    <a class="btn" href="stats.php?<?= htmlspecialchars(http_build_query(['month' => $statsNext, 'per' => $statsPer]), ENT_QUOTES | ENT_HTML5, 'UTF-8') ?>" aria-label="Next month, <?= htmlspecialchars(statsMonthLabel($statsNext), ENT_QUOTES | ENT_HTML5, 'UTF-8') ?>">&rarr;</a>
                                <?php } else { ?>
                                    <span class="btn off" aria-disabled="true" aria-label="Next month, not yet">&rarr;</span>
                                <?php } ?>
                            </div>
                        </div>
                        <?php
                        if (false === $statsRows) {
                            echo '<p class="notice error" role="alert">There was an error trying to fetch the tests of '.$statsLabel.'.</p>';
                        } else {
                            $statsSummary = statsSummarize($statsRows);
                            if (0 === $statsSummary['tests']) {
                                echo '<p class="empty">No tests in '.$statsLabel.'.</p>';
                            } else {
                                ?>
                                <p class="total"><strong><?= (int) $statsSummary['tests'] ?></strong> tests in <?= $statsLabel ?>, by the clock of the database (UTC with SQLite)</p>
                                <div class="metrics">
                                    <?php
                                    foreach (['dl' => 'Download', 'ul' => 'Upload', 'ping' => 'Ping', 'jitter' => 'Jitter'] as $statsKey => $statsName) {
                                        $statsLine = $statsSummary[$statsKey];
                                        $statsIsSpeed = 'dl' === $statsKey || 'ul' === $statsKey;
                                        // The number and the unit of P10, the median and P90
                                        $statsParts = [];
                                        foreach (['p10', 'p50', 'p90'] as $statsPoint) {
                                            if (null === $statsLine[$statsPoint]) {
                                                $statsParts[$statsPoint] = null;
                                            } elseif ($statsIsSpeed) {
                                                $statsParts[$statsPoint] = statsSpeedParts($statsLine[$statsPoint]);
                                            } else {
                                                $statsParts[$statsPoint] = [number_format($statsLine[$statsPoint], 1, '.', ''), 'ms'];
                                            }
                                        }
                                        $statsBarData = statsBar($statsLine);
                                        ?>
                                        <article class="metric <?= $statsKey ?>">
                                            <h3><?= $statsName ?></h3>
                                            <?php if (null === $statsParts['p50']) { ?>
                                                <p class="median muted">-<span class="what">No valid values</span></p>
                                            <?php } else { ?>
                                                <p class="median"><?= $statsParts['p50'][0] ?> <span class="unit"><?= $statsParts['p50'][1] ?></span><span class="what">median</span></p>
                                                <?php if (null !== $statsBarData) { ?>
                                                    <div class="bar" aria-hidden="true"><span style="left:<?= $statsBarData['left'] ?>%;width:<?= $statsBarData['width'] ?>%"></span><i style="left:<?= $statsBarData['median'] ?>%"></i></div>
                                                <?php } ?>
                                                <dl class="range">
                                                    <div><dt>P10</dt><dd><?= $statsParts['p10'][0] ?> <?= $statsParts['p10'][1] ?></dd></div>
                                                    <div><dt>P90</dt><dd><?= $statsParts['p90'][0] ?> <?= $statsParts['p90'][1] ?></dd></div>
                                                </dl>
                                            <?php } ?>
                                            <p class="valid<?= $statsLine['count'] > 0 && $statsLine['count'] < STATS_FEW_SAMPLES ? ' few' : '' ?>"><?= (int) $statsLine['count'] ?> valid <?= 1 === $statsLine['count'] ? 'value' : 'values' ?><?= $statsLine['count'] > 0 && $statsLine['count'] < STATS_FEW_SAMPLES ? ', too few for solid percentiles' : '' ?></p>
                                        </article>
                                        <?php
                                    }
                                    ?>
                                </div>
                                <?php
                            }
                        }
                        ?>
                    </section>
                    <?php
                }
                ?>
                <section aria-labelledby="tests-title">
                    <?php
                    $speedtests = [];
                    $statsListed = !('id' === ($_GET['op'] ?? '') && !empty($_GET['id']));
                    if ($statsListed) {
                        $statsTotal = countSpeedtestUsers();
                        $statsPages = false === $statsTotal ? 1 : statsPageCount($statsTotal, $statsPer);
                        $statsPage = false === $statsTotal ? 1 : statsPageNumber($_GET['page'] ?? null, $statsTotal, $statsPer);
                    }
                    ?>
                    <div class="head">
                        <h2 id="tests-title"><?= $statsListed ? 'Tests' : 'Test' ?><?php if ($statsListed && is_int($statsTotal) && $statsTotal > 0) { ?> <span class="muted">(<?= $statsTotal ?>)</span><?php } ?></h2>
                        <div class="tools">
                            <form action="stats.php" method="GET" role="search">
                                <input type="hidden" name="op" value="id" />
                                <label class="sr-only" for="id">Test ID</label>
                                <input type="text" name="id" id="id" placeholder="Test ID" value="" />
                                <input type="submit" class="main" value="Find" />
                            </form>
                            <?php if ($statsListed) { ?>
                                <form action="stats.php" method="GET">
                                    <input type="hidden" name="month" value="<?= htmlspecialchars($statsMonth, ENT_QUOTES | ENT_HTML5, 'UTF-8') ?>" />
                                    <label class="muted" for="per">Per page</label>
                                    <select name="per" id="per" onchange="this.form.submit()">
                                        <?php foreach (STATS_PER_PAGE_CHOICES as $statsChoice) { ?>
                                            <option value="<?= $statsChoice ?>"<?= $statsChoice === $statsPer ? ' selected' : '' ?>><?= $statsChoice ?></option>
                                        <?php } ?>
                                    </select>
                                    <noscript><input type="submit" value="Apply" /></noscript>
                                </form>
                            <?php } ?>
                        </div>
                    </div>
                    <?php
                    if (!$statsListed) {
                        $speedtest = getSpeedtestUserById($_GET['id']);
                        if (false === $speedtest) {
                            echo '<p class="notice error" role="alert">There was an error trying to fetch the test result for ID "'.htmlspecialchars($_GET['id'], ENT_HTML5, 'UTF-8').'".</p>';
                        } elseif (null === $speedtest) {
                            echo '<p class="notice">Could not find a test result for ID "'.htmlspecialchars($_GET['id'], ENT_HTML5, 'UTF-8').'".</p>';
                        } else {
                            $speedtests = [$speedtest];
                        }
                        ?>
                        <p><a class="btn" href="stats.php">&larr; All tests</a></p>
                        <?php
                    } elseif (false === $statsTotal) {
                        echo '<p class="notice error" role="alert">There was an error trying to fetch the test results.</p>';
                    } elseif (0 === $statsTotal) {
                        echo '<p class="empty">Could not find any test results in database.</p>';
                    } else {
                        $statsList = getSpeedtestUsersPage($statsPer, ($statsPage - 1) * $statsPer);
                        if (false === $statsList) {
                            echo '<p class="notice error" role="alert">There was an error trying to fetch the test results.</p>';
                        } else {
                            $statsFirst = ($statsPage - 1) * $statsPer + 1;
                            ?>
                            <p class="muted">Showing <?= $statsFirst ?> to <?= $statsFirst + count($statsList) - 1 ?> of <?= $statsTotal ?>, the newest first</p>
                            <?= statsPager($statsPage, $statsPages, $statsPer, $statsMonth, $statsTotal, 'Pages of tests, top') ?>
                            <div class="scroll" role="region" aria-label="Tests" tabindex="0">
                                <table class="tests">
                                    <thead>
                                        <tr>
                                            <th scope="col">Test</th>
                                            <th scope="col">Network</th>
                                            <th scope="col" class="num">Download (Mbit/s)</th>
                                            <th scope="col" class="num">Upload (Mbit/s)</th>
                                            <th scope="col" class="num">Ping (ms)</th>
                                            <th scope="col" class="num">Jitter (ms)</th>
                                            <th scope="col">Browser</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                    <?php foreach ($statsList as $statsTest) { ?>
                                        <tr>
                                            <td class="when" data-label="Test"><?= htmlspecialchars($statsTest['timestamp'], ENT_HTML5, 'UTF-8') ?><a href="stats.php?<?= htmlspecialchars(http_build_query(['op' => 'id', 'id' => $statsTest['id_shown']]), ENT_QUOTES | ENT_HTML5, 'UTF-8') ?>">#<?= htmlspecialchars($statsTest['id_shown'], ENT_HTML5, 'UTF-8') ?></a></td>
                                            <td class="net" data-label="Network"><div><?= htmlspecialchars($statsTest['ip'], ENT_HTML5, 'UTF-8') ?><span><?= htmlspecialchars(statsIspText($statsTest['ispinfo']), ENT_HTML5, 'UTF-8') ?></span></div></td>
                                            <td class="num" data-label="Download"><?= htmlspecialchars(statsCell($statsTest['dl'], true), ENT_HTML5, 'UTF-8') ?></td>
                                            <td class="num" data-label="Upload"><?= htmlspecialchars(statsCell($statsTest['ul'], true), ENT_HTML5, 'UTF-8') ?></td>
                                            <td class="num" data-label="Ping"><?= htmlspecialchars(statsCell($statsTest['ping'], false), ENT_HTML5, 'UTF-8') ?></td>
                                            <td class="num" data-label="Jitter"><?= htmlspecialchars(statsCell($statsTest['jitter'], false), ENT_HTML5, 'UTF-8') ?></td>
                                            <td class="ua" data-label="Browser"><?= htmlspecialchars($statsTest['ua'], ENT_HTML5, 'UTF-8') ?></td>
                                        </tr>
                                    <?php } ?>
                                    </tbody>
                                </table>
                            </div>
                            <?= statsPager($statsPage, $statsPages, $statsPer, $statsMonth, $statsTotal, 'Pages of tests, bottom') ?>
                            <?php
                        }
                    }
                    foreach ($speedtests as $speedtest) {
                        // The values as they were stored, with their unit when they are numbers
                        $statsWithUnit = function ($raw, $unit) {
                            return htmlspecialchars((string) $raw, ENT_HTML5, 'UTF-8').(null !== statsCleanValue($raw) ? ' <span class="unit">'.$unit.'</span>' : '');
                        };
                        ?>
                        <dl class="detail">
                            <div><dt>Test ID</dt><dd><?= htmlspecialchars($speedtest['id_formatted'], ENT_HTML5, 'UTF-8') ?></dd></div>
                            <div><dt>Date and time</dt><dd><?= htmlspecialchars($speedtest['timestamp'], ENT_HTML5, 'UTF-8') ?></dd></div>
                            <div><dt>IP and ISP</dt><dd><?= htmlspecialchars($speedtest['ip'], ENT_HTML5, 'UTF-8') ?><br /><?= htmlspecialchars(statsIspText($speedtest['ispinfo']), ENT_HTML5, 'UTF-8') ?></dd></div>
                            <div><dt>User agent and locale</dt><dd><?= htmlspecialchars($speedtest['ua'], ENT_HTML5, 'UTF-8') ?><br /><?= htmlspecialchars($speedtest['lang'], ENT_HTML5, 'UTF-8') ?></dd></div>
                            <div><dt>Download speed</dt><dd><?= $statsWithUnit($speedtest['dl'], 'Mbit/s') ?></dd></div>
                            <div><dt>Upload speed</dt><dd><?= $statsWithUnit($speedtest['ul'], 'Mbit/s') ?></dd></div>
                            <div><dt>Ping</dt><dd><?= $statsWithUnit($speedtest['ping'], 'ms') ?></dd></div>
                            <div><dt>Jitter</dt><dd><?= $statsWithUnit($speedtest['jitter'], 'ms') ?></dd></div>
                        </dl>
                        <?php if ('' !== (string) $speedtest['ispinfo']) { ?>
                            <details>
                                <summary>ISP info as stored</summary>
                                <pre><?= htmlspecialchars($speedtest['ispinfo'], ENT_HTML5, 'UTF-8') ?></pre>
                            </details>
                        <?php } ?>
                        <?php if ('' !== (string) $speedtest['extra']) { ?>
                            <details>
                                <summary>Extra info</summary>
                                <pre><?= htmlspecialchars($speedtest['extra'], ENT_HTML5, 'UTF-8') ?></pre>
                            </details>
                        <?php } ?>
                        <?php if ('' !== (string) $speedtest['log']) { ?>
                            <details>
                                <summary>Log</summary>
                                <pre><?= htmlspecialchars($speedtest['log'], ENT_HTML5, 'UTF-8') ?></pre>
                            </details>
                        <?php } ?>
                        <?php
                    }
                    ?>
                </section>
                </main>
                <?php
            }
        } else {
            ?>
            <main class="login">
                <h1>LibreSpeed Stats</h1>
                <p class="muted">Log in to see the tests stored by this server.</p>
                <?php if ('login' === ($_GET['op'] ?? '') && is_string($_POST['password'] ?? null)) { ?>
                    <p class="notice error" role="alert">That password did not work.</p>
                <?php } ?>
                <form action="stats.php?op=login" method="POST">
                    <label for="password">Password</label>
                    <input type="password" name="password" id="password" autocomplete="current-password" value="" />
                    <input type="submit" class="main" value="Log in" />
                </form>
            </main>
            <?php
        }
        ?>
        </div>
    </body>
</html>
