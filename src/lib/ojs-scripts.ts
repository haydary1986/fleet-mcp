// Builders for the remote bash/PHP that drive OJS installs. These encode the
// battle-tested recipe from prior production OJS installs:
//  - OJS files dir OUTSIDE webroot, docroot chmod 755 (the 0750 -> 404 bug)
//  - CLI install via tools/install.php reading answers from stdin
//  - config.inc.php fixes: allowed_hosts (the "400 Bad Request" bug), base_url,
//    trust_x_forwarded_for (behind Cloudflare)
//  - journal creation via a bootstrap script, with the 3 known gotchas patched
//
// NOTE: these use String.raw so backslashes (PHP namespaces, "\n", regex "\s",
// escaped quotes) survive verbatim. Never introduce a literal "${" or backtick
// into a script body — only intended TS interpolations use ${...}.

export interface OjsInstallParams {
  domain: string;
  docroot: string;
  filesDir: string;
  dbName: string;
  dbUser: string;
  dbPass: string;
  adminUser: string;
  adminPass: string;
  adminEmail: string;
  primaryLocale: string;
  additionalLocales: string; // comma-separated locale keys, e.g. "ar"
  oaiRepoId: string;
  phpBin: string;
  version: string;
  downloadBase: string;
  phpHandler: string;
  setPhpHandler: boolean;
}

export function buildInstallScript(p: OjsInstallParams): string {
  const tarball = `ojs-${p.version}.tar.gz`;
  const src = `/tmp/ojs-${p.version}`;
  const handlerStep = p.setPhpHandler
    ? String.raw`
echo "==> Set PHP handler -> ${p.phpHandler}"
plesk bin site --update "${p.domain}" -php_handler_id "${p.phpHandler}" 2>&1 \
  || plesk bin subdomain --update "$(echo ${p.domain} | cut -d. -f1)" -domain "$(echo ${p.domain} | cut -d. -f2-)" -php_handler_id "${p.phpHandler}" 2>&1 \
  || echo "(could not set PHP handler automatically — set it in Plesk)"`
    : "";

  return String.raw`
echo "==> Preflight"
DOCROOT="${p.docroot}"
if [ ! -d "$DOCROOT" ]; then
  echo "ERROR: docroot $DOCROOT does not exist. Create the Plesk subdomain/webspace + DNS first."
  exit 2
fi
WEBUSER=$(stat -c '%U' "$DOCROOT")
echo "web user = $WEBUSER"

echo "==> Download OJS ${p.version} (if not already cached)"
if [ ! -d "${src}" ]; then
  cd /tmp
  wget -q "${p.downloadBase}/${tarball}" -O "${tarball}" || { echo "ERROR: download failed"; exit 3; }
  tar xzf "${tarball}"
fi

echo "==> Deploy OJS into docroot"
cp -a "${src}/." "$DOCROOT/"
rm -f "$DOCROOT/index.html"
chmod 755 "$DOCROOT"

echo "==> Create files dir (outside webroot)"
mkdir -p "${p.filesDir}"
chmod 750 "${p.filesDir}"

echo "==> Create database + user (Plesk)"
plesk bin database --create "${p.dbName}" -domain "${p.domain}" -server localhost -type mysql 2>&1 || echo "(database may already exist)"
plesk bin database --create-dbuser "${p.dbUser}" -passwd '${p.dbPass}' -domain "${p.domain}" -database "${p.dbName}" 2>&1 || echo "(db user may already exist)"

echo "==> Run OJS CLI installer"
cat > /tmp/ojs-answers <<'ANS'
${p.primaryLocale}
${p.additionalLocales}
${p.filesDir}
${p.adminUser}
${p.adminPass}
${p.adminPass}
${p.adminEmail}
mysqli
localhost
${p.dbUser}
${p.dbPass}
${p.dbName}
${p.oaiRepoId}
N
Y
ANS
cd "$DOCROOT"
"${p.phpBin}" tools/install.php < /tmp/ojs-answers 2>&1 | tail -50
rm -f /tmp/ojs-answers

echo "==> Patch config.inc.php (allowed_hosts / base_url / trust_x_forwarded_for)"
OJS_DOMAIN="${p.domain}" OJS_DOCROOT="$DOCROOT" python3 - <<'PY'
import os, re, json
p = os.path.join(os.environ['OJS_DOCROOT'], 'config.inc.php')
dom = os.environ['OJS_DOMAIN']
if not os.path.exists(p):
    print('config.inc.php missing — install likely failed'); raise SystemExit(4)
s = open(p).read()
def set_ini(text, key, line):
    pat = re.compile(r'^;?\s*' + re.escape(key) + r'\s*=.*$', re.M)
    return pat.sub(line, text, count=1) if pat.search(text) else text + "\n" + line + "\n"
allowed_ini = ('[' + json.dumps(dom) + ']').replace('"', '\\"')   # [\"domain\"]
s = set_ini(s, 'allowed_hosts', 'allowed_hosts = "' + allowed_ini + '"')
s = set_ini(s, 'base_url', 'base_url = "https://' + dom + '"')
s = set_ini(s, 'trust_x_forwarded_for', 'trust_x_forwarded_for = On')
open(p, 'w').write(s)
print('patched config.inc.php')
PY

echo "==> Fix ownership"
chown -R "$WEBUSER":psacln "$DOCROOT" "${p.filesDir}"
${handlerStep}

echo "==> Smoke test"
curl -sS -o /dev/null -w "homepage HTTP %{http_code}\n" "https://${p.domain}/" || true
echo "==> DONE"
`;
}

function phpStr(s: string): string {
  return "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
}
function phpList(items: string[]): string {
  return "[" + items.map(phpStr).join(",") + "]";
}
function phpAssoc(obj: Record<string, string>): string {
  return (
    "[" +
    Object.entries(obj)
      .map(([k, v]) => `${phpStr(k)}=>${phpStr(v)}`)
      .join(",") +
    "]"
  );
}

export interface OjsJournalParams {
  domain: string;
  docroot: string;
  urlPath: string;
  primaryLocale: string;
  locales: string[];
  nameByLocale: Record<string, string>;
  acronymByLocale: Record<string, string>;
  phpBin: string;
}

export function buildJournalScript(p: OjsJournalParams): string {
  const localesPhp = phpList(p.locales);
  const namePhp = phpAssoc(p.nameByLocale);
  const acronymPhp = phpAssoc(p.acronymByLocale);

  const php = String.raw`<?php
require(dirname(__FILE__).'/bootstrap.php');
use APP\core\Application;
use APP\core\Services;
use APP\facades\Repo;
use PKP\core\Registry;
use PKP\db\DAORegistry;

$request = Application::get()->getRequest();
Registry::set('user', Repo::user()->get(1));   // authenticate admin (id 1)

$dao = Application::getContextDAO();
$ctx = $dao->getByPath(${phpStr(p.urlPath)});
if ($ctx) {
  echo "context already exists id=".$ctx->getId()."\n";
} else {
  $ctx = $dao->newDataObject();
  $ctx->setAllData([
    'primaryLocale' => ${phpStr(p.primaryLocale)},
    'supportedLocales' => ${localesPhp},
    'supportedFormLocales' => ${localesPhp},
    'supportedSubmissionLocales' => ${localesPhp},
    'name' => ${namePhp},
    'acronym' => ${acronymPhp},
    'urlPath' => ${phpStr(p.urlPath)},
    'enabled' => true,
  ]);
  try {
    $ctx = Services::get('context')->add($ctx, $request);
    echo "context added id=".$ctx->getId()."\n";
  } catch (\Throwable $e) {
    // GOTCHA 1: add() throws getContext()-on-null at loadAllPlugins in CLI.
    // Core objects were already created; re-fetch the context by path.
    $ctx = $dao->getByPath(${phpStr(p.urlPath)});
    if (!$ctx) { fwrite(STDERR, "FATAL: context not created: ".$e->getMessage()."\n"); exit(1); }
    echo "context recovered id=".$ctx->getId()." (handled loadAllPlugins throw)\n";
  }
}
$ctxId = $ctx->getId();

// GOTCHA 2: ensure a default section exists (the skipped afterAddContext hook).
$existing = iterator_to_array(Repo::section()->getCollector()->filterByContextIds([$ctxId])->getMany());
if (count($existing) === 0) {
  $section = Repo::section()->newDataObject();
  $section->setTitle('Articles', 'en');
  $section->setTitle('مقالات', 'ar');
  $section->setAbbrev('ART', 'en');
  $section->setAbbrev('مقالات', 'ar');
  $section->setMetaIndexed(true);
  $section->setMetaReviewed(true);
  $section->setContextId($ctxId);
  $section->setSequence(1);
  $section->setEditorRestricted(false);
  Repo::section()->add($section);
  echo "default section created\n";
} else {
  echo "section already present\n";
}

// GOTCHA 3: enable the default theme for THIS context (site-level enable isn't
// enough -> public frontend 500 getOption()-on-null without it).
$psd = DAORegistry::getDAO('PluginSettingsDAO');
$psd->updateSetting($ctxId, 'defaultthemeplugin', 'enabled', true, 'bool');
echo "default theme enabled for context $ctxId\n";
echo "OK ctxId=$ctxId\n";
`;

  const b64 = Buffer.from(php, "utf8").toString("base64");

  return String.raw`
DOCROOT="${p.docroot}"
WEBUSER=$(stat -c '%U' "$DOCROOT")
echo "${b64}" | base64 -d > "$DOCROOT/tools/mkjournal.php"
"${p.phpBin}" "$DOCROOT/tools/mkjournal.php" 2>&1 | tail -40
rm -f "$DOCROOT/tools/mkjournal.php"
echo "==> Clear template/css cache"
rm -f "$DOCROOT"/cache/t_compile/* "$DOCROOT"/cache/*.php 2>/dev/null || true
chown -R "$WEBUSER":psacln "$DOCROOT"
curl -sS -o /dev/null -w "journal HTTP %{http_code}\n" "https://${p.domain}/index.php/${p.urlPath}/" || true
`;
}
