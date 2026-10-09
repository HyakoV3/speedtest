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
        <!-- The colors and the light or dark theme of the better pages, when frontend/ sits next to results/. Without it the fallbacks below give a light page. -->
        <script src="../frontend/better/javascript/theme.js"></script>
        <link rel="stylesheet" href="../frontend/better/styling/tokens.css" />
        <style type="text/css">
            html{
                background:var(--bg, #fbfcfe);
                color:var(--text, #1f2430);
                font-family:system-ui, "Segoe UI", "Roboto", sans-serif;
            }
            body{
                box-sizing:border-box;
                max-width:70em;
                margin:2em auto;
                padding:1em 1em 3em 1em;
                background:var(--surface, #ffffff);
                border:1px solid var(--border, #d9dde5);
                border-radius:var(--radius-card, 1rem);
            }
            h1,h2,h3{
                font-weight:600;
                margin-bottom:0.3em;
            }
            h1{
                text-align:center;
            }
            input{
                font:inherit;
                color:inherit;
                background:var(--surface-muted, #f3f5f9);
                border:1px solid var(--border, #d9dde5);
                border-radius:var(--radius-button, 0.75rem);
                padding:0.35em 0.8em;
            }
            input[type="submit"]{
                background:var(--primary, #2563eb);
                color:var(--on-primary, #ffffff);
                border-color:transparent;
                cursor:pointer;
            }
            :focus-visible{
                outline:2px solid var(--primary, #2563eb);
                outline-offset:2px;
            }
            table{
                margin:2em 0;
                width:100%;
                border-collapse:collapse;
            }
            th,td{
                border:1px solid var(--border, #d9dde5);
                padding:0.4em 0.6em;
                text-align:left;
            }
            th{
                width:6em;
                color:var(--muted, #667085);
                font-weight:600;
            }
            td{
                word-break:break-all;
            }
            caption{
                text-align:left;
                color:var(--muted, #667085);
                padding-bottom:0.4em;
            }
            .summary th{
                width:auto;
            }
            .summary td{
                word-break:normal;
                text-align:right;
                font-variant-numeric:tabular-nums;
            }
            .scroll{
                overflow-x:auto;
            }
            div{
                margin:1em 0;
            }
            @media (max-width:40em){
                body{
                    margin:0;
                    border:none;
                    border-radius:0;
                }
            }
        </style>
    </head>
    <body>
        <h1>LibreSpeed - Stats</h1>
        <?php
        if (!isset($stats_password) || $stats_password === 'PASSWORD') {
            ?>
                Please set $stats_password in telemetry_settings.php to enable access.
            <?php
        } elseif ($_SESSION['logged'] === true) {
            if ($_GET['op'] === 'logout') {
                $_SESSION['logged'] = false;
                ?><script type="text/javascript">window.location=location.protocol+"//"+location.host+location.pathname;</script><?php
            } else {
                ?>
                <form action="stats.php" method="GET"><input type="hidden" name="op" value="logout" /><input type="submit" value="Logout" /></form>
                <?php
                // The summary of a month, unless one test was asked for
                if ('id' !== ($_GET['op'] ?? '') || empty($_GET['id'])) {
                    $statsMonth = statsMonth($_GET['month'] ?? null);
                    list($statsFrom, $statsTo) = statsMonthBounds($statsMonth, $db_type);
                    $statsRows = getSpeedtestValuesBetween($statsFrom, $statsTo);
                    ?>
                    <form action="stats.php" method="GET">
                        <h3>Monthly summary</h3>
                        <label for="month">Month</label>
                        <input type="month" name="month" id="month" value="<?= htmlspecialchars($statsMonth, ENT_QUOTES | ENT_HTML5, 'UTF-8') ?>" placeholder="YYYY-MM" />
                        <input type="submit" value="Show" />
                    </form>
                    <?php
                    if (false === $statsRows) {
                        echo '<div>There was an error trying to fetch the tests of '.htmlspecialchars($statsMonth, ENT_HTML5, 'UTF-8').'.</div>';
                    } else {
                        $statsSummary = statsSummarize($statsRows);
                        ?>
                        <div class="scroll">
                            <table class="summary">
                                <caption><?= (int) $statsSummary['tests'] ?> tests in <?= htmlspecialchars($statsMonth, ENT_HTML5, 'UTF-8') ?>, by the clock of the database (UTC with SQLite)</caption>
                                <tr><th scope="col"></th><th scope="col">Valid</th><th scope="col">P10</th><th scope="col">Median</th><th scope="col">P90</th></tr>
                                <?php
                                foreach (['dl' => 'Download', 'ul' => 'Upload', 'ping' => 'Ping', 'jitter' => 'Jitter'] as $statsKey => $statsLabel) {
                                    $statsLine = $statsSummary[$statsKey];
                                    $statsFormat = 'dl' === $statsKey || 'ul' === $statsKey ? 'statsFormatSpeed' : 'statsFormatMs';
                                    echo '<tr><th scope="row">'.$statsLabel.'</th><td>'.$statsLine['count'].'</td><td>'.$statsFormat($statsLine['p10'])
                                        .'</td><td>'.$statsFormat($statsLine['p50']).'</td><td>'.$statsFormat($statsLine['p90']).'</td></tr>';
                                }
                                ?>
                            </table>
                        </div>
                        <?php
                    }
                }
                ?>
                <form action="stats.php" method="GET">
                    <h3>Search test results</h3>
                    <input type="hidden" name="op" value="id" />
                    <input type="text" name="id" id="id" placeholder="Test ID" value=""/>
                    <input type="submit" value="Find" />
                    <input type="submit" onclick="document.getElementById('id').value=''" value="Show last 100 tests" />
                </form>
                <?php
                if ($_GET['op'] === 'id' && !empty($_GET['id'])) {
                    $speedtest = getSpeedtestUserById($_GET['id']);
                    $speedtests = [];
                    if (false === $speedtest) {
                        echo '<div>There was an error trying to fetch the test result for ID "'.htmlspecialchars($_GET['id'], ENT_HTML5, 'UTF-8').'".</div>';
                    } elseif (null === $speedtest) {
                        echo '<div>Could not find a test result for ID "'.htmlspecialchars($_GET['id'], ENT_HTML5, 'UTF-8').'".</div>';
                    } else {
                        $speedtests = [$speedtest];
                    }
                } else {
                    $speedtests = getLatestSpeedtestUsers();
                    if (false === $speedtests) {
                        echo '<div>There was an error trying to fetch latest test results.</div>';
                    } elseif (empty($speedtests)) {
                        echo '<div>Could not find any test results in database.</div>';
                    }
                }
                foreach ($speedtests as $speedtest) {
                    ?>
                    <table>
                        <tr>
                            <th>Test ID</th>
                            <td><?= htmlspecialchars($speedtest['id_formatted'], ENT_HTML5, 'UTF-8') ?></td>
                        </tr>
                        <tr>
                            <th>Date and time</th>
                            <td><?= htmlspecialchars($speedtest['timestamp'], ENT_HTML5, 'UTF-8') ?></td>
                        </tr>
                        <tr>
                            <th>IP and ISP Info</th>
                            <td>
                                <?= htmlspecialchars($speedtest['ip'], ENT_HTML5, 'UTF-8') ?><br/>
                                <?= htmlspecialchars($speedtest['ispinfo'], ENT_HTML5, 'UTF-8') ?>
                            </td>
                        </tr>
                        <tr>
                            <th>User agent and locale</th>
                            <td><?= htmlspecialchars($speedtest['ua'], ENT_HTML5, 'UTF-8') ?><br/>
                                <?= htmlspecialchars($speedtest['lang'], ENT_HTML5, 'UTF-8') ?>
                            </td>
                        </tr>
                        <tr>
                            <th>Download speed</th>
                            <td><?= htmlspecialchars($speedtest['dl'], ENT_HTML5, 'UTF-8') ?></td>
                        </tr>
                        <tr>
                            <th>Upload speed</th>
                            <td><?= htmlspecialchars($speedtest['ul'], ENT_HTML5, 'UTF-8') ?></td>
                        </tr>
                        <tr>
                            <th>Ping</th>
                            <td><?= htmlspecialchars($speedtest['ping'], ENT_HTML5, 'UTF-8') ?></td>
                        </tr>
                        <tr>
                            <th>Jitter</th>
                            <td><?= htmlspecialchars($speedtest['jitter'], ENT_HTML5, 'UTF-8') ?></td>
                        </tr>
                        <tr>
                            <th>Log</th>
                            <td><?= htmlspecialchars($speedtest['log'], ENT_HTML5, 'UTF-8') ?></td>
                        </tr>
                        <tr>
                            <th>Extra info</th>
                            <td><?= htmlspecialchars($speedtest['extra'], ENT_HTML5, 'UTF-8') ?></td>
                        </tr>
                    </table>
                    <?php
                }
            }
        } else {
            ?>
            <form action="stats.php?op=login" method="POST">
                <h3>Login</h3>
                <input type="password" name="password" placeholder="Password" value=""/>
                <input type="submit" value="Login" />
            </form>
            <?php
        }
        ?>
    </body>
</html>
